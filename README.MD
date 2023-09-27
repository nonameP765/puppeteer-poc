# Puppeteer POC

웹 크롤링을 위한 Puppeteer POC 입니다.

NodeJS 환경 구성과 Puppeteer 가 얼마나 발전했는지 체험해 보기 위한 프로젝트입니다.

## 사용스택

- 크롤러: [Puppeteer](https://pptr.dev/)
- DB: [Sqlite3](https://www.sqlite.org/index.html)
- Typescript, Node.js
- [yarn berry pnp](https://yarnpkg.com/features/pnp)

## 세팅

### .cache 폴더

puppeteer 는 크롬을 사용하기 때문에 크롬을 설치해야 합니다.

.cache 폴더를 구성하면 되며 예제는 .cache-for-win64.zip 파일을 압축해제 하면 됩니다.

타 OS나 궁금한 점은 [공식 문서](https://pptr.dev/)를 참고하세요

### Yarn

```
yarn install
```

## 사용법

```
yarn start
```

페이지가 열리며 로그인 이후를 감지해 자동으로 실행됩니다.

## DB 필드별 설명

- text: 전체 텍스트입니다.
- startChar: 시작 텍스트입니다. 인덱스가 걸려있습니다.
- isNew: 데이터의 사용 여부를 분간하는 필드입니다.
  - -1 : 삭제
  - 0 : 레거시 데이터
  - 1 : 신규 데이터