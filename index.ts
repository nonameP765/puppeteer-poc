import puppeteer from 'puppeteer';
import { verbose } from 'sqlite3';

const sqlite3 = verbose();
const db = new sqlite3.Database('./words.sqlite3');

db.serialize(() => {
  (async () => {
    const browser = await puppeteer.launch({
      headless: false
    });
    const page = await browser.newPage();

    await page.goto('https://kkutu.io/login');
    await page.setViewport({ width: 1080, height: 1024 });

    let isTyped = false;

    const inputAndSubmit = async (value: string) => {
      isTyped = true;
      const inputs = await page.$$('input.chat-input');

      await Promise.all(
        inputs.map(async (input) => {
          const style = await input.evaluate((el) => {
            const computedStyle = window.getComputedStyle(el);
            return computedStyle.getPropertyValue('display');
          });
          if (style !== 'none') {
            await input.type(value);
            await input.press('Enter');
          }
        })
      );
      isTyped = false;
    };

    const getIsMyTurn = async () => {
      const div = await page.$('#Middle > div.GameBox.Product > div > div.game-input');

      if (!div) {
        return false;
      }

      const style = await div.evaluate((el) => {
        const computedStyle = window.getComputedStyle(el);
        return computedStyle.getPropertyValue('display');
      });

      return style !== 'none';
    };

    const getDisplayInfo = async () => {
      const divs = await page.$$(
        '#Middle > div.GameBox.Product > div > div.game-head > div.jjoriping > div > div.jjo-display.ellipse'
      );

      const visibleDivs = await Promise.all(
        divs.map(async (div) => {
          const style = await div.evaluate((el) => {
            const computedStyle = window.getComputedStyle(el);
            return computedStyle.getPropertyValue('display');
          });
          if (style !== 'none') {
            const text = (await div.evaluate((el) => el.textContent)) || '';
            const startChar = (() => {
              if (text.includes('(') && text.includes(')')) {
                return [
                  text.slice(0, text.indexOf('(')),
                  text.slice(text.indexOf('(') + 1, text.indexOf(')'))
                ];
              }
              if (text.length === 1) {
                return [text];
              }

              return undefined;
            })();

            return {
              text,
              startChar,
              isEnd: Boolean(await div.$('div > label:nth-child(2)')),
              isFail: Boolean(await div.$('.game-fail-text'))
            };
          }
          return null;
        })
      );

      for (const data of visibleDivs) {
        if (data !== null) {
          return data;
        }
      }

      return null;
    };

    const usedWords: Set<string> = new Set();
    let beforeText = '';
    let beforeFailText = '';

    const saveOnDB = (text: string) => {
      const temp = `${text}`;
      db.get(`SELECT text FROM korean WHERE text="${temp}"`, (err, row) => {
        if (!row || err) {
          db.run('INSERT INTO korean VALUES (?, ?, ?)', temp, temp[0], 1);
        }
      });
    };
    const removeOnDB = (text: string) => {
      const temp = `${text}`;
      db.run(`UPDATE korean SET isNew = -1 WHERE text="${temp}"`);
    };

    const run = async () => {
      if (page.url().startsWith('https://kkutu.io/?server=')) {
        const isMyTurn = await getIsMyTurn();
        const displayInfo = await getDisplayInfo();

        if (!displayInfo || displayInfo.text === '잠시 후 게임이 시작됩니다!') {
          // pass
        } else if (displayInfo.isEnd || displayInfo.text === '게임 끝!') {
          if (displayInfo.isEnd) {
            saveOnDB(displayInfo.text);
          }
          usedWords.clear();
        } else if (isMyTurn) {
          if (displayInfo.isFail && beforeFailText !== displayInfo.text) {
            beforeFailText = displayInfo.text;
            console.log(displayInfo.text);
            if (!displayInfo.text.includes(':')) {
              removeOnDB(displayInfo.text);
            }
          }

          if (!isTyped && displayInfo.startChar) {
            db.get(
              `SELECT text 
                    FROM korean
                    WHERE startChar IN (${displayInfo.startChar
                      .map((char) => `"${char}"`)
                      .join(',')})
                    AND text NOT IN (${Array.from(usedWords)
                      .map((word) => `"${word}"`)
                      .join(',')})
                    AND isNew >= 0
                    ORDER BY RANDOM()
                    LIMIT 1;`,
              //                     ORDER BY LENGTH(text) DESC
              (err, row) => {
                if (err) {
                  console.error(err);
                  return;
                }

                if (row) {
                  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                  // @ts-ignore
                  if ('text' in row && typeof row.text === 'string') {
                    inputAndSubmit(row.text);
                    usedWords.add(row.text);
                  }
                }
              }
            );
          }
        } else if (
          displayInfo.text.length > 1 &&
          !displayInfo.text.includes('(') &&
          !displayInfo.text.includes(')')
        ) {
          if (!displayInfo.text.startsWith(beforeText) && !usedWords.has(beforeText)) {
            usedWords.add(beforeText);
            saveOnDB(beforeText);
          }
          beforeText = displayInfo.text;
        }
      }
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      run();
    };

    run();
  })();
});
