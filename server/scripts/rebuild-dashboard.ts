/**
 * Rebuilds the Dashboard tab against the five-channel model.
 * Usage: npx tsx scripts/rebuild-dashboard.ts <spreadsheetId> <repTab> [<repTab> …]
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { CHANNELS, STAGE_VALUES, TEMPLATE_HEADERS } from '../src/sheets/sheetTemplate.js'
import { columnLetter } from '../src/sheets/mapping.js'

const STAGE_COL = columnLetter(TEMPLATE_HEADERS.indexOf('Stage'))
const OUTREACH_COL = columnLetter(TEMPLATE_HEADERS.indexOf('Outreach'))

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
})

async function main(): Promise<void> {
  const [spreadsheetId, ...reps] = process.argv.slice(2)
  if (!spreadsheetId || !reps.length) {
    console.error('usage: npx tsx scripts/rebuild-dashboard.ts <spreadsheetId> <repTab> [...]')
    process.exit(1)
  }
  const client = new SheetsClient(new SheetsAuth())

  const join = (expr: (tab: string) => string) => reps.map(expr).join('+')
  const stageExpr = (stage: string) => join((t) => `COUNTIF('${t}'!$${STAGE_COL}:$${STAGE_COL},"${stage}")`)
  const stagesExpr = (...s: string[]) => '=' + s.map(stageExpr).join('+')
  const total = '=' + join((t) => `COUNTA('${t}'!$A$2:$A)`)
  // Any channel touched at all — the Outreach column is non-empty exactly then.
  const contacted = '=' + join((t) => `COUNTIF('${t}'!$${OUTREACH_COL}$2:$${OUTREACH_COL},"?*")`)
  const pct = (cell: string) => `=IF($A$5>0,TEXT(${cell}/$A$5,"0%"),"—")`
  const rate = (cell: string, label: string) => `=IF($A$5>0,TEXT(${cell}/$A$5,"0%"),"0%")&" ${label}"`

  const rows: string[][] = []
  const put = (r: number, v: string[]) => { rows[r - 1] = v }

  put(1, ['ATLAS LEAD PIPELINE'])
  put(2, ['=TEXT(TODAY(),"dddd, d mmmm yyyy")'])
  put(4, ['LEADS', 'CONTACTED', 'INTERESTED', 'DEMOS', 'TRIALS', 'WON', 'LOST'])
  put(5, [
    total,
    contacted,
    stagesExpr('Interested', 'Demo Booked', 'Trial Active', 'Closed-Won'),
    stagesExpr('Demo Booked', 'Trial Active', 'Closed-Won'),
    stagesExpr('Trial Active', 'Closed-Won'),
    stagesExpr('Closed-Won'),
    stagesExpr('Closed-Lost', 'Not Interested', 'DNC'),
  ])
  put(6, [
    'Total in pipeline',
    rate('B5', 'contact rate'), rate('C5', 'interest rate'), rate('D5', 'demo rate'),
    rate('E5', 'trial rate'), rate('F5', 'win rate'), rate('G5', 'lost rate'),
  ])

  put(8, ['STAGE BREAKDOWN'])
  put(9, ['STAGE', 'COUNT', '%'])
  STAGE_VALUES.forEach((s, i) => put(10 + i, [s, stagesExpr(s), pct(`B${10 + i}`)]))

  const chStart = 10 + STAGE_VALUES.length + 1
  put(chStart, ['CHANNEL PERFORMANCE'])
  put(chStart + 1, ['CHANNEL', 'TOUCHED', 'REPLIED', 'REPLY RATE'])
  CHANNELS.forEach((c, i) => {
    const col = columnLetter(TEMPLATE_HEADERS.indexOf(c.header))
    const r = chStart + 2 + i
    put(r, [
      c.prefix,
      '=' + join((t) => `COUNTIF('${t}'!$${col}$2:$${col},"?*")`),
      '=' + join((t) => `COUNTIF('${t}'!$${col}:$${col},"Replied")`),
      `=IF(B${r}>0,TEXT(C${r}/B${r},"0%"),"—")`,
    ])
  })

  const repStart = chStart + 2 + CHANNELS.length + 1
  put(repStart, ['REP BREAKDOWN'])
  put(repStart + 1, ['REP', 'LEADS', 'CONTACTED', 'WON', 'CONTACT RATE'])
  reps.forEach((t, i) => {
    const r = repStart + 2 + i
    put(r, [
      t,
      `=COUNTA('${t}'!$A$2:$A)`,
      `=COUNTIF('${t}'!$${OUTREACH_COL}$2:$${OUTREACH_COL},"?*")`,
      `=COUNTIF('${t}'!$${STAGE_COL}:$${STAGE_COL},"Closed-Won")`,
      `=IF(B${r}>0,TEXT(C${r}/B${r},"0%"),"—")`,
    ])
  })

  const height = repStart + 2 + reps.length
  for (let i = 0; i < height; i++) if (!rows[i]) rows[i] = ['']

  const tabs = await client.getTabs(spreadsheetId)
  const existing = tabs.find((t) => t.title === 'Dashboard')
  if (existing) await client.batchUpdate(spreadsheetId, [{ deleteSheet: { sheetId: existing.sheetId } }])
  const res = await client.batchUpdate(spreadsheetId, [{
    addSheet: {
      properties: {
        title: 'Dashboard', index: 0,
        gridProperties: { rowCount: height + 10, columnCount: 8, hideGridlines: true },
        tabColor: rgb('#000000'),
      },
    },
  }])
  const sheetId = (res.replies[0] as { addSheet: { properties: { sheetId: number } } }).addSheet.properties.sheetId

  await client.updateValues(spreadsheetId, "'Dashboard'!A1", rows)

  const band = (row: number, bg: string, fg: string, size: number, bold = true, cols = 7) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: cols },
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb(bg), verticalAlignment: 'MIDDLE',
          textFormat: { foregroundColor: rgb(fg), bold, fontSize: size },
        },
      },
      fields: 'userEnteredFormat',
    },
  })
  const KPI = ['#284c8c', '#2d7f8c', '#bf7f0c', '#662da5', '#1472b7', '#1e8c21', '#b22121']
  const style: unknown[] = [
    band(1, '#000000', '#ffffff', 18),
    band(2, '#000000', '#b2bfd8', 10, false),
    band(3, '#d8d8d8', '#000000', 10),
    ...KPI.map((c, i) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb(c), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: rgb('#ffffff'), bold: true, fontSize: 9 },
          },
        },
        fields: 'userEnteredFormat',
      },
    })),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb('#f7f7f9'), horizontalAlignment: 'CENTER', verticalAlignment: 'MIDDLE',
            textFormat: { foregroundColor: rgb('#14141e'), bold: true, fontSize: 24 },
          },
        },
        fields: 'userEnteredFormat',
      },
    },
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 5, endRowIndex: 6, startColumnIndex: 0, endColumnIndex: 7 },
        cell: {
          userEnteredFormat: {
            backgroundColor: rgb('#f7f7f9'), horizontalAlignment: 'CENTER',
            textFormat: { foregroundColor: rgb('#72727f'), fontSize: 8 },
          },
        },
        fields: 'userEnteredFormat',
      },
    },
    ...[8, chStart, repStart].map((r) => band(r, '#e0eaf9', '#192659', 12)),
    ...[9, chStart + 1, repStart + 1].map((r) => band(r, '#efeff2', '#3f3f4c', 10)),
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 210 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 1, endIndex: 5 }, properties: { pixelSize: 115 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 46 }, fields: 'pixelSize' } },
    { updateDimensionProperties: { range: { sheetId, dimension: 'ROWS', startIndex: 4, endIndex: 5 }, properties: { pixelSize: 52 }, fields: 'pixelSize' } },
  ]
  await client.batchUpdate(spreadsheetId, style)
  console.log(`Dashboard rebuilt for ${reps.join(', ')} (${height} rows)`)
}

main().catch((e) => { console.error(e); process.exit(1) })
