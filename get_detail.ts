import { BrowserContext, chromium, Locator, Page } from "playwright";
import { parse } from "csv-parse/sync";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { writeFile } from "node:fs";
import { Buffer } from "node:buffer";
import * as fs from "fs";

const isDebug = true;
const headersCSVFilename = "detail_headers.csv";
const inputCSVFilename = "detail_input.csv";
const outputCSVFilenamePrefix = "output/detail";
const targets: string[][] = [];
const headersDict: { [key: string]: string } = {};
const additionalHeaders = ["safe_prohibited_rate", "safe_permission_rate", "safe_sds_publish_rate", "safe_sds_notify_rate", "safe_tokka_rate"]
const numbersDict = { "０": "0", "１": "1", "２": "2", "３": "3", "４": "4", "５": "5", "６": "6", "７": "7", "８": "8", "９": "9", "．": "." };

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
  const listRows = await page.locator(".accordion").locator("ul").first().locator("li").first().locator(".close_open");
  for (let i = 0; i < await listRows.count(); i++) {
    const listElement = await listRows.nth(i);
    const lawTitle = await trimAll(await listElement.locator(".ac-node2.ac-node2-indent"));
    if (lawTitle !== target[0]) continue;

    const tableHeaders: string[] = [];
    const tableData: string[][] = [];
    const rowElements = await listElement.locator(".ac-t-column1");
    for (let list_i = 0; list_i < await rowElements.count(); list_i++) {
      if (isDebug && list_i > 0) break;
      const rowElement = await rowElements.nth(list_i);
      console.log("\nProcessing", await trimAll(rowElement), "list");

      const linkElement = await rowElement.locator("a").first();
      const [tablePage] = await Promise.all([
        context.waitForEvent("page"),
        linkElement.click()
      ])

      //「中間検索結果」政令番号等による表示
      await tablePage.goto(tablePage.url());
      console.log("Opened initial table");
      const [detailTablePage] = await Promise.all([
        context.waitForEvent("page", { timeout: 120000 }),
        tablePage.locator(".right-item.block").locator("a").first().click()
      ])

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url(), { timeout: 120000 });
      console.log("Opened detail table");
      await detailTablePage.locator(".setButton.standard").nth(1).click();

      //「中間検索結果」＜表示項目の追加設定＞
      await detailTablePage.goto(detailTablePage.url(), { timeout: 120000 });
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
      await detailTablePage.locator("#redisplay").first().click({ timeout: 120000 });

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url(), { timeout: 120000 });
      console.log("Updated detail table (", detailTablePage.url(), ")");
      let currentPageNum = 1;
      while (true) {
        const tableRows = await detailTablePage.locator(".list-table").locator("tr");
        for (let j = 0; j < await tableRows.count(); j++) {
          const rowElement = await tableRows.nth(j);
          const tds = await rowElement.locator(`${j === 0 ? "td table tbody tr td:nth-child(1)" : "td"}`);

          let rowHeight = 0;
          for (let k = 0; k < await tds.count(); k++) {
            const td = await tds.nth(k);
            const height = (await trimAll(td)).split("\n").length;
            rowHeight = height > rowHeight ? height : rowHeight;
          }
          for (let h = 0; h < rowHeight; h++) {
            tableData.push([]);
            let header_k = 0;
            for (let k = 0; k < await tds.count(); k++) {
              const td = await tds.nth(k);
              const texts = await trimAll(td);
              if (list_i === 0 && currentPageNum === 1 && j === 0) {
                tableHeaders.push(headersDict[texts] || texts);
                if (additionalHeaders.includes(headersDict[texts])) {
                  tableHeaders.push(headersDict[texts] + "_operator");
                  tableHeaders.push(headersDict[texts] + "_threshold");
                }
              }
              else {
                if (k === 0) {
                  if (rowHeight > 1) {
                    tableData[tableData.length - 1].push(`${texts}-${h + 1}`);
                  } else {
                    tableData[tableData.length - 1].push(texts);
                  }
                } else {
                  tableData[tableData.length - 1].push(texts.split("\n")[h] || texts);
                  if (additionalHeaders.includes(tableHeaders[header_k])) {
                    const text = texts.split("\n")[h] || texts;
                    if (text.length <= 1) {
                      tableData[tableData.length - 1].push("");
                      tableData[tableData.length - 1].push("");
                    }
                    else {
                      let operator = text.slice(0, 1);
                      let threshold = text.slice(1, text.length);
                      if (operator === "＞") {
                        operator = "gt";
                      } if (operator === "≧") {
                        operator = "gte";
                      }
                      for (const key in numbersDict) {
                        threshold = threshold.replaceAll(key, numbersDict[key]);
                      }
                      if (text === "すべて") {
                        operator = "";
                        threshold = "";
                      }
                      tableData[tableData.length - 1].push(operator || "");
                      tableData[tableData.length - 1].push(threshold || "");
                    }
                    header_k += 2;
                  }
                }
              }
              header_k += 1;
            }
          }
        }

        const paginationButtons = await detailTablePage.locator("a").getByText("次のページ＞＞");
        if (await paginationButtons.count() < 2 || isDebug) {
          break;
        }
        await paginationButtons.first().click({ timeout: 120000 });
        currentPageNum += 1;
        console.log("Turned to page", currentPageNum);
      }
    }
    saveTableToCSV(tableHeaders, tableData, target[0]);
  }
}

async function trimAll(element: Locator): Promise<string> {
  return (await element.allInnerTexts())[0].trim();
}

function saveTableToCSV(headers: string[], data: string[][], targetList: string): void {
  const writeData: { [key: string]: string }[] = [];
  data.filter((dat) => {
    return !isNaN((dat[0] || "?").replaceAll("-", ""));
  }).forEach(rowData => {
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
