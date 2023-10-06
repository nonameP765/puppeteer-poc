import puppeteer from 'puppeteer';
import { verbose } from 'sqlite3';

const sqlite3 = verbose();
const db = new sqlite3.Database('./words.sqlite3');

type GameMode = 'manner' | 'mannerLong' | 'noManner';

db.serialize(() => {
  (async () => {
    const browser = await puppeteer.launch({
      headless: false
    });
    const page = await browser.newPage();

    await page.goto('https://kkutu.io/login');
    await page.setViewport({ width: 1080, height: 1024 });

    const inputAndSubmit = async (value: string) => {
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
                const start = text.slice(0, text.indexOf('('));
                const changed = text.slice(text.indexOf('(') + 1, text.indexOf(')'));

                db.run(`INSERT INTO change VALUES ("${start}", "${changed}")`, () => {
                  // pass
                });

                return [start, changed];
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
          db.run(
            'INSERT INTO korean VALUES (NULL, ?, ?, ?, ?)',
            temp,
            temp[0],
            temp[temp.length - 1],
            1
          );
        }
      });
    };
    const removeOnDB = (text: string) => {
      const temp = `${text}`;
      db.run(`DELETE FROM korean WHERE text="${temp}"`);
    };

    const run = async (gameMode: GameMode) => {
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
            if (!displayInfo.text.includes(':')) {
              removeOnDB(displayInfo.text);
            }
          }

          if (displayInfo.startChar) {
            if (
              displayInfo.text.length > 1 &&
              !displayInfo.text.includes('(') &&
              !displayInfo.text.includes(')') &&
              !displayInfo.text.includes('... T.T') &&
              !displayInfo.text.includes(':')
            ) {
              if (
                !displayInfo.text.startsWith(beforeText) &&
                !usedWords.has(beforeText) &&
                !displayInfo.isFail
              ) {
                usedWords.add(beforeText);
                saveOnDB(beforeText);
              }
              beforeText = displayInfo.text;
            }

            const { startChar } = displayInfo;
            if (gameMode === 'manner') {
              const row1 = await new Promise((resolve) => {
                db.get(
                  `
                  SELECT 
                  k1.text,
                  (
                    SELECT 
                      COUNT(k2.id)
                      FROM korean k2
                      WHERE ( 
                          k2.startChar = k1.endChar
                          OR k2.startChar = c1.changed
                        ) AND k2.text NOT IN (${Array.from(usedWords)
                          .map((word) => `"${word}"`)
                          .join(',')}) 
                  ) AS count
                  FROM ( 
                    SELECT *
                    FROM korean k0
                    WHERE
                      k0.text NOT IN (${Array.from(usedWords)
                        .map((word) => `"${word}"`)
                        .join(',')})
                      AND k0.startChar IN (${startChar.map((char) => `"${char}"`).join(',')})
                    GROUP BY k0.endChar
                  ) k1
                  LEFT JOIN change c1 ON c1.start = k1.endChar
                  LEFT JOIN korean k3 ON k3.startChar = k1.endChar OR c1.changed = k3.startChar
                  WHERE k3.id IS NOT NULL
                  ${usedWords.size === 0 ? 'AND LENGTH(k1.text) <= 30' : ''}
                  GROUP BY k1.id
                  ORDER BY count ASC, LENGTH(k1.text) DESC
                  LIMIT 1
                  `,
                  (err, row) => {
                    if (err || !row) {
                      resolve(null);
                    }

                    if (row) {
                      resolve(row);
                    }
                  }
                );
              });

              if (row1) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                if ('text' in row1 && typeof row1.text === 'string') {
                  await new Promise((resolve) => {
                    setTimeout(resolve, (row1.text as string).length * 200 + 500);
                  });
                  await inputAndSubmit(row1.text);
                  usedWords.add(row1.text);
                }
              }
            }

            if (gameMode === 'noManner') {
              const row1 = await new Promise((resolve) => {
                db.get(
                  `
                SELECT 
                  k1.text,
                  (
                    SELECT 
                      COUNT(k2.id)
                      FROM korean k2
                      WHERE ( 
                          k2.startChar = k1.endChar
                          OR k2.startChar = c1.changed
                        ) AND k2.text NOT IN (${Array.from(usedWords)
                          .map((word) => `"${word}"`)
                          .join(',')}) 
                  ) AS count
                FROM ( 
                  SELECT *
                  FROM korean k0
                  WHERE
                    k0.text NOT IN (${Array.from(usedWords)
                      .map((word) => `"${word}"`)
                      .join(',')})
                    AND k0.startChar IN (${startChar.map((char) => `"${char}"`).join(',')})
                  GROUP BY k0.endChar
                ) k1
                LEFT JOIN change c1 ON c1.start = k1.endChar
                ${usedWords.size === 0 ? 'WHERE LENGTH(k1.text) <= 30' : ''}
                GROUP BY k1.id
                ORDER BY count ASC, LENGTH(k1.text) DESC
                LIMIT 1
                `,
                  (err, row) => {
                    if (err || !row) {
                      resolve(null);
                    } else if (row) {
                      resolve(row);
                    }
                  }
                );
              });

              if (row1) {
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                if ('text' in row1 && typeof row1.text === 'string') {
                  await inputAndSubmit(row1.text);
                  usedWords.add(row1.text);
                }
              }
            }

            if (gameMode === 'mannerLong') {
              const row1 = await new Promise<{ text: string; count: number } | null>((resolve) => {
                db.get(
                  `
                    SELECT 
                      k1.text,
                      (
                        SELECT 
                          COUNT(k2.id)
                          FROM korean k2
                          WHERE ( 
                              k2.startChar = k1.endChar
                              OR k2.startChar = c1.changed
                            ) AND k2.text NOT IN (${Array.from(usedWords)
                              .map((word) => `"${word}"`)
                              .join(',')}) 
                      ) AS count
                    FROM ( 
                      SELECT *
                      FROM korean k0
                      WHERE
                        k0.text NOT IN (${Array.from(usedWords)
                          .map((word) => `"${word}"`)
                          .join(',')})
                        AND k0.startChar IN (${startChar.map((char) => `"${char}"`).join(',')})
                      GROUP BY k0.endChar
                    ) k1
                    LEFT JOIN change c1 ON c1.start = k1.endChar
                    LEFT JOIN korean k3 ON k3.startChar = k1.endChar OR c1.changed = k3.startChar
                    WHERE
                      k3.id IS NOT NULL
                    ${usedWords.size === 0 ? 'AND LENGTH(k1.text) <= 30' : ''}
                    GROUP BY k1.id
                    ORDER BY count ASC, LENGTH(k1.text) DESC
                    LIMIT 1
                    `,
                  (err, row) => {
                    if (err || !row) {
                      resolve(null);
                    }

                    if (row) {
                      resolve(row as { text: string; count: number });
                    }
                  }
                );
              });

              if (row1) {
                if (row1.count <= 5) {
                  await inputAndSubmit(row1.text);
                  usedWords.add(row1.text);
                } else {
                  const row2 = await new Promise<{ text: string } | null>((resolve) => {
                    db.get(
                      `
                    SELECT k1.text 
                    FROM (
                      SELECT *
                      FROM korean k0
                      WHERE 
                        k0.startChar IN (${startChar.map((char) => `"${char}"`).join(',')})
                        AND k0.text NOT IN (${Array.from(usedWords)
                          .map((word) => `"${word}"`)
                          .join(',')})
                    ) k1
                    LEFT JOIN change c1 ON c1.start = k1.endChar
                    LEFT JOIN korean k3 ON k1.endChar = k3.startChar OR c1.changed = k3.startChar
                    WHERE 
                      NOT EXISTS(
                        SELECT k2.id
                        FROM korean k2
                        WHERE 
                          (
                            k2.startChar = k1.endChar
                            OR k2.startChar = c1.changed
                          )
                          AND LENGTH(k2.text) >= LENGTH(k1.text)
                          AND text NOT IN (${Array.from(usedWords)
                            .map((word) => `"${word}"`)
                            .join(',')})
                        LIMIT 1
                      )
                      AND k3.id IS NOT NULL
                      ${usedWords.size === 0 ? 'AND LENGTH(k1.text) <= 30' : ''}
                    ORDER BY LENGTH(k1.text) DESC
                    LIMIT 1;`,
                      (err, row) => {
                        if (err || !row) {
                          resolve(null);
                        }
                        resolve(row as { text: string });
                      }
                    );
                  });

                  if (row2) {
                    await inputAndSubmit(row2.text);
                    usedWords.add(row2.text);
                  } else {
                    await inputAndSubmit(row1.text);
                    usedWords.add(row1.text);
                  }
                }
              }
            }
          }
        } else if (
          displayInfo.text.length > 1 &&
          !displayInfo.text.includes('(') &&
          !displayInfo.text.includes(')') &&
          !displayInfo.text.includes('... T.T') &&
          !displayInfo.text.includes(':')
        ) {
          if (
            !displayInfo.text.startsWith(beforeText) &&
            !usedWords.has(beforeText) &&
            !displayInfo.isFail
          ) {
            usedWords.add(beforeText);
            saveOnDB(beforeText);
          }
          beforeText = displayInfo.text;
        }
      }

      await new Promise((resolve) => {
        setTimeout(resolve, 25);
      });

      run(gameMode);
    };

    run((process.argv[2] as GameMode) || 'mannerLong');
  })();
});
