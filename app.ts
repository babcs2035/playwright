import { chromium, Locator } from "playwright";
import { mkConfig, generateCsv, asString } from "export-to-csv";
import { write, writeFile } from "node:fs";
import { Buffer } from "node:buffer";

async function trimAll(element: Locator): Promise<string> {
  return (await element.allInnerTexts())[0].trim();
}

function generateCsvFromTable(headers: string[], data: string[][]): void {
  const writeData: { [key: string]: string }[] = [];
  data.forEach(rowData => {
    const row: { [key: string]: string } = {};
    for (let i = 0; i < rowData.length; i++) {
      row[headers[i]] = rowData[i];
    } writeData.push(row);
  })
  console.log("writeData:", writeData);
  console.log("headers:", headers);

  const filename = `output.csv`;
  const csv = generateCsv(mkConfig({
    columnHeaders: headers
  }))(writeData);
  writeFile(filename, new Uint8Array(Buffer.from(asString(csv))), (err) => {
    if (err) {
      throw err;
    }
    console.log("file saved: ", filename);
  });
}

const targetLists = ["毒物及び劇物取締法"];
const targetLaws = ["毒物及び劇物取締法"];

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  //「法規制等一覧」
  await page.goto("https://www.chem-info.nite.go.jp/chem/chrip/chrip_search/sltLst");
  console.log("Opened lists page");
  const openButtons = await page.locator(".ac-default");
  for (let i = 0; i < await openButtons.count(); i++) {
    const button = await openButtons.nth(i);
    await button.click();
  }

  const listRows = await page.locator(".ac-t-column1");
  for (let i = 0; i < await listRows.count(); i++) {
    const rowElement = await listRows.nth(i);
    const listName = (await rowElement.allInnerTexts())[0].trim();
    if (targetLists.includes(listName)) {
      const linkElement = await rowElement.locator("a").first();
      const [tablePage] = await Promise.all([
        context.waitForEvent('page'),
        linkElement.click()
      ])

      //「中間検索結果」政令番号等による表示
      await tablePage.goto(tablePage.url());
      console.log("Opened", listName, "table");
      const [detailTablePage] = await Promise.all([
        context.waitForEvent('page'),
        tablePage.locator(".right-item.block").locator("a").first().click()
      ])

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url());
      console.log("Opened", listName, "detail table");
      await detailTablePage.locator(".setButton.standard").nth(1).click();

      //「中間検索結果」＜表示項目の追加設定＞
      await detailTablePage.goto(detailTablePage.url());
      console.log("Opened", listName, "additional settings");
      const lawsList = await detailTablePage.locator(".ac-node2.ac-node2-indent");
      for (let j = 0; j < await lawsList.count(); j++) {
        const lawElement = await lawsList.nth(j);
        const lawName = (await lawElement.allInnerTexts())[0].trim();
        if (targetLaws.includes(lawName)) {
          console.log("Checked", lawName, "law");
          const lawLinkElement = await lawElement.locator("input").first();
          await lawLinkElement.setChecked(true);
        }
      }
      await detailTablePage.locator("#redisplay").first().click();

      //「中間検索結果」CHRIP_ID及びCAS RNによる表示
      await detailTablePage.goto(detailTablePage.url());
      console.log("Updated", listName, "detail table");
      console.log(detailTablePage.url());

      const tableRows = await detailTablePage.locator(".list-table").locator("tr");
      const tableHeaders: string[] = [];
      const tableData: string[][] = [];
      for (let j = 0; j < await tableRows.count(); j++) {
        const rowElement = await tableRows.nth(j);
        const tds = await rowElement.locator(`${j === 0 ? "td table tbody tr td:nth-child(1)" : "td"}`);
        for (let k = 0; k < await tds.count(); k++) {
          const td = await tds.nth(k);
          if (j == 0) {
            tableHeaders.push(await trimAll(td));
          }
          else {
            if (k == 0) {
              tableData.push([]);
            }
            tableData[j - 1].push(await trimAll(td));
          }
        }
      }
      generateCsvFromTable(tableHeaders, tableData);
    }
  }

  console.log("Finished");
  await browser.close();
})();
