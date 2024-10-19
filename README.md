# playwright

## 概要

- `get_detail.ts`
  - 入力で与えられた法律内の全リストの詳細情報を取得する
  - 入力ファイル `detail_input.csv` には，法律名と表示項目の追加設定でチェックする法律名をコンマ区切りで記述する
  - 入力ファイル `detail_headers.csv` には，オリジナルの表示項目名に対応する index をコンマ区切りで記述する
  - 出力ファイル `output/detail-*.csv` には，法律内の全リストの詳細情報が記述される
- `get_all.ts`
  - 全法律内の全リストの簡易情報を取得する
  - 出力ファイル `output/simple-*.csv` には，法律内の全リストの簡易情報が記述される
- `merge_all.ts`
  - 全法律内の全リストの簡易情報を結合する
  - 入力ファイル `output/simple-*.csv` を結合し，出力ファイル `output/merged.csv` に記述する

## 実行

```bash
yarn
npx playwright install
npx tsx *.ts
```
