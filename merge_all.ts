// merge all csv tables into one
//
import * as fs from "fs";

(async () => {
  const csvFiles = await fs.promises.readdir("output/");
  const csvFileNames = csvFiles.filter(file => file.endsWith(".csv") && file.startsWith("simple-"));
  if (csvFileNames.length === 0) {
    console.log("No csv files found");
    return;
  }

  const mergedTable: string[][] = [];
  for (const csvFileName of csvFileNames) {
    const csvData = await fs.promises.readFile(`output/${csvFileName}`, "utf-8");
    const table = csvData.split("\n").map(row => row.split(","));
    if (mergedTable.length === 0) {
      mergedTable.push(table[0]);
    }
    mergedTable.push(...table.slice(1));
  }
  const mergedData = Array.from(new Set(mergedTable.map(row => row.join(","))))
    .map(row => row.split(","))
    .filter(row => row.length > 1);
  const mergedCSV = mergedData.map(row => row.join(",")).join("\n");
  fs.promises.writeFile("output/merged.csv", mergedCSV);
  console.log("Merged csv files into merged.csv");
})();
