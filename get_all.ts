import { BrowserContext, chromium, Locator, Page } from "playwright";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { writeFile } from "node:fs";
import { Buffer } from "node:buffer";
import { access } from "fs/promises";

const isDebug = false;
const outputCSVFilenamePrefix = "output/simple";
const headers = ["no", "chrip_id", "casrn", "ja_name"];

async function isFileExist(filename: string) {
  try {
    await access(filename);
    return true;
  } catch {
    return false;
  }
}

async function initializeListsPage(page: Page) {

  //「法規制等一覧」
  await page.goto("https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/sltLst", { timeout: 600000 });
  const openButtons = await page.locator(".ac-default");
  for (let i = 0; i < await openButtons.count(); i++) {
    const button = await openButtons.nth(i);
    await button.click({ timeout: 600000 });
  }
  console.log("Initialized lists page");
}

async function process(context: BrowserContext, page: Page) {

  //「法規制等一覧」
  const listRows = await page.locator(".accordion").locator("ul").first().locator("li").first().locator(".close_open");
  for (let i = 0; i < await listRows.count(); i++) {
    const listElement = await listRows.nth(i);
    const lawTitle = await trimAll(await listElement.locator(".ac-node2.ac-node2-indent"));
    if (await isFileExist(`${outputCSVFilenamePrefix}-${lawTitle}.csv`)) {
      console.log("--------------------------------\nSkipped", lawTitle);
      continue;
    }
    console.log("--------------------------------\nProcessing", lawTitle);

    const tableData: string[][] = [];
    const rowElements = await listElement.locator(".ac-t-column1");
    for (let list_i = 0; list_i < await rowElements.count(); list_i++) {
      if (isDebug && list_i > 0) break;
      const rowElement = await rowElements.nth(list_i);
      console.log("\nProcessing", await trimAll(rowElement), "list");

      const linkElement = await rowElement.locator("a").first();
      const [tablePage] = await Promise.all([
        context.waitForEvent("page", { timeout: 600000 }),
        linkElement.click({ timeout: 600000 })
      ])

      //「中間検索結果」政令番号等による表示
      await tablePage.goto(tablePage.url(), { timeout: 600000 });
      console.log("Opened initial table");
      const [detailTablePage] = await Promise.all([
        context.waitForEvent("page", { timeout: 600000 }),
        tablePage.locator(".right-item.block").locator("a").first().click({ timeout: 600000 })
      ])

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url(), { timeout: 600000 });
      console.log("Opened detail table (", detailTablePage.url(), ")");

      let currentPageNum = 1;
      while (true) {
        const tableRows = await detailTablePage.locator(".list-table").locator("tr");
        for (let j = 0; j < await tableRows.count(); j++) {
          const rowElement = await tableRows.nth(j);
          const tds = await rowElement.locator(`${j === 0 ? "td table tbody tr td:nth-child(1)" : "td"}`);
          tableData.push([]);
          for (let k = 0; k < await tds.count(); k++) {
            const td = await tds.nth(k);
            const texts = await trimAll(td);
            tableData[tableData.length - 1].push(texts);
          }
        }

        const paginationButtons = await detailTablePage.locator("a").getByText("次のページ＞＞");
        if (await paginationButtons.count() < 2 || isDebug) {
          break;
        }
        await paginationButtons.first().click({ timeout: 600000 });
        currentPageNum += 1;
        console.log("Turned to page", currentPageNum);
      }
    }
    saveTableToCSV(headers, tableData, lawTitle);
    await initializeListsPage(page);
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

  await initializeListsPage(page);
  await process(context, page);

  console.log("\nDone");
  await browser.close();
})();
