import { BrowserContext, chromium, Locator, Page } from "playwright";
import { parse } from "csv-parse/sync";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { writeFile } from "node:fs";
import { Buffer } from "node:buffer";
import * as fs from "fs";

const isDebug = true;
const headersCSVFilename = "headers.csv";
const inputCSVFilename = "input.csv";
const outputCSVFilenamePrefix = "output";
const targets: string[][] = [];
const headersDict: { [key: string]: string } = {};

function getHeadersDict() {
  const data = fs.readFileSync(headersCSVFilename);
  const records = parse(data);
  for (const record of records) {
    headersDict[record[0]] = record[1];
  }
  console.log("Loaded headers CSV file");
}

function getTargets() {
  const data = fs.readFileSync(inputCSVFilename);
  const records = parse(data);
  for (const record of records) {
    targets.push(record);
  }
  console.log("Loaded targets CSV file");
}

async function initializeListsPage(page: Page) {

  //「法規制等一覧」
  await page.goto("https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/sltLst");
  const openButtons = await page.locator(".ac-default");
  for (let i = 0; i < await openButtons.count(); i++) {
    const button = await openButtons.nth(i);
    await button.click();
  }
  console.log("Initialized lists page");
}

async function processTarget(context: BrowserContext, page: Page, target: string[]) {

  //「法規制等一覧」
  const listRows = await page.locator(".ac-t-column1");
  for (let i = 0; i < await listRows.count(); i++) {
    const rowElement = await listRows.nth(i);
    const listName = (await rowElement.allInnerTexts())[0].trim();
    if (listName === target[0]) {
      const linkElement = await rowElement.locator("a").first();
      const [tablePage] = await Promise.all([
        context.waitForEvent("page"),
        linkElement.click()
      ])

      //「中間検索結果」政令番号等による表示
      await tablePage.goto(tablePage.url());
      console.log("Opened initial table");
      const [detailTablePage] = await Promise.all([
        context.waitForEvent("page"),
        tablePage.locator(".right-item.block").locator("a").first().click()
      ])

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url());
      console.log("Opened detail table");
      await detailTablePage.locator(".setButton.standard").nth(1).click();

      //「中間検索結果」＜表示項目の追加設定＞
      await detailTablePage.goto(detailTablePage.url());
      console.log("Opened additional settings");
      const lawsList = await detailTablePage.locator(".ac-node2.ac-node2-indent");
      for (let j = 0; j < await lawsList.count(); j++) {
        const lawElement = await lawsList.nth(j);
        const lawName = (await lawElement.allInnerTexts())[0].trim();
        if (lawName === target[1]) {
          console.log("Checked", lawName, "law");
          const lawLinkElement = await lawElement.locator("input").first();
          await lawLinkElement.setChecked(true);
        }
      }
      await detailTablePage.locator("#redisplay").first().click();

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url());
      console.log("Updated detail table (url:", detailTablePage.url(), ")");
      const tableHeaders: string[] = [];
      const tableData: string[][] = [];
      let currentPageNum = 1;
      while (true) {
        const tableRows = await detailTablePage.locator(".list-table").locator("tr");
        for (let j = 0; j < await tableRows.count(); j++) {
          const rowElement = await tableRows.nth(j);
          const tds = await rowElement.locator(`${j === 0 ? "td table tbody tr td:nth-child(1)" : "td"}`);
          for (let k = 0; k < await tds.count(); k++) {
            const td = await tds.nth(k);
            if (currentPageNum === 1 && j === 0) {
              tableHeaders.push(headersDict[await trimAll(td)] || await trimAll(td));
            }
            else {
              if (k == 0) {
                tableData.push([]);
              }
              tableData[(currentPageNum - 1) * 100 + j - 1].push(await trimAll(td));
            }
          }
        }

        const paginationButtons = await detailTablePage.locator("a").getByText("次のページ＞＞");
        if (await paginationButtons.count() < 2 || (isDebug && currentPageNum >= 2)) {
          break;
        }
        await paginationButtons.first().click();
        currentPageNum += 1;
        console.log("Turned to page", currentPageNum);
      }
      saveTableToCSV(tableHeaders, tableData, target[0]);
    }
  }
}

async function trimAll(element: Locator): Promise<string> {
  return (await element.allInnerTexts())[0].trim();
}

function saveTableToCSV(headers: string[], data: string[][], targetList: string): void {
  const writeData: { [key: string]: string }[] = [];
  data.slice(headers.length).forEach(rowData => {
    const row: { [key: string]: string } = {};
    for (let i = 0; i < rowData.length; i++) {
      row[headers[i]] = rowData[i];
    } writeData.push(row);
  });

  const csv = generateCsv(mkConfig({
    columnHeaders: headers
  }))(writeData);
  writeFile(`${outputCSVFilenamePrefix}-${targetList}.csv`, new Uint8Array(Buffer.from(asString(csv))), (err) => {
    if (err) {
      throw err;
    }
    console.log("Saved CSV file");
  });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  getHeadersDict();
  getTargets();
  for (const target of targets) {
    console.log("--------------------------------\nProcessing", target[0]);
    await initializeListsPage(page);
    await processTarget(context, page, target);
  }

  console.log("\nDone");
  await browser.close();
})();
