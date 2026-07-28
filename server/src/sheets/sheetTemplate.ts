import { ALL_COLUMNS } from '../export/csv.js'

/**
 * Single source of truth for how an Atlas lead tab looks. Mirrors the role
 * selectors.ts plays for the Maps DOM: when the design or the outreach
 * vocabulary changes, this is the only file that changes.
 */

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
})

const NAVY = '#0f142d'
const HEADER_BORDER = '#2a3358'
const BODY_FG = '#33333f'

export const STAGE_VALUES = [
  'New', 'Contacted', 'Interested', 'Demo Booked', 'Trial Active',
  'Closed-Won', 'Closed-Lost', 'Not Interested', 'DNC',
]

const STAGE_COLOURS: Record<string, [string, string]> = {
  'New': ['#e5e5e5', '#000000'],
  'Contacted': ['#b2b2b2', '#000000'],
  'Interested': ['#ffbf00', '#ffffff'],
  'Demo Booked': ['#4c00cc', '#ffffff'],
  'Trial Active': ['#0066cc', '#ffffff'],
  'Closed-Won': ['#218c21', '#ffffff'],
  'Closed-Lost': ['#d83333', '#ffffff'],
  'Not Interested': ['#e57f19', '#ffffff'],
  'DNC': ['#7f1919', '#ffffff'],
}

export const PRIORITY_VALUES = ['1', '2', '3', '4']
const PRIORITY_COLOURS = ['#db1414', '#f2720c', '#f2cc0c', '#7fb2e5']

/**
 * Channel columns are named "<X> Status" rather than "Facebook"/"Instagram"/"LinkedIn"
 * because Business already has facebook/instagram/linkedin URL fields and header
 * matching is case-insensitive — the obvious names would collide.
 */
export const CHANNELS = [
  {
    header: 'Call Status', prefix: 'Call',
    values: ['No Answer', 'Voicemail', 'Answered', 'Interested', 'Not Interested', 'Callback', 'Wrong Number', 'DNC'],
  },
  {
    header: 'SMS Status', prefix: 'SMS',
    values: ['Sent', 'Delivered', 'Replied', 'Opted Out'],
  },
  {
    header: 'FB Status', prefix: 'FB',
    values: ['Request Sent', 'Accepted', 'DM Sent', 'Replied', 'Ignored'],
  },
  {
    header: 'IG Status', prefix: 'IG',
    values: ['Followed', 'DM Sent', 'Replied', 'Ignored'],
  },
  {
    header: 'LI Status', prefix: 'LI',
    values: ['Request Sent', 'Accepted', 'InMail Sent', 'Replied', 'Ignored'],
  },
]

/** Outcome buckets, so five channels need four colour rules instead of twenty-six. */
const OUTCOME_COLOURS: { values: string[]; bg: string; fg: string }[] = [
  { values: ['Replied', 'Interested', 'Accepted', 'Answered'], bg: '#218c21', fg: '#ffffff' },
  { values: ['Sent', 'Request Sent', 'DM Sent', 'InMail Sent', 'Delivered', 'Followed', 'Callback'], bg: '#ffbf00', fg: '#ffffff' },
  { values: ['Not Interested', 'Opted Out', 'DNC', 'Wrong Number', 'Ignored'], bg: '#d83333', fg: '#ffffff' },
  { values: ['No Answer', 'Voicemail'], bg: '#b2b2b2', fg: '#000000' },
]

/** The nine CRM columns, in sheet order, that sit between `name` and the Atlas fields. */
export const CRM_HEADERS = [
  'Stage', ...CHANNELS.map((c) => c.header), 'Outreach', 'Priority', 'Notes',
]

/** Headers that must never be treated as an Atlas field, whatever they are called. */
export const RESERVED_HEADERS = [...CRM_HEADERS]

/** name, then the CRM block, then the remaining Atlas fields. */
export const TEMPLATE_HEADERS: string[] = [
  'name',
  ...CRM_HEADERS,
  ...ALL_COLUMNS.filter((c) => c !== 'name').map(String),
]

export const OUTREACH_COLUMN_INDEX = TEMPLATE_HEADERS.indexOf('Outreach')

/**
 * One whole-column array formula, so rows appended by Atlas populate themselves.
 * Written once at H2; Atlas must never write a value into this column.
 */
export const OUTREACH_FORMULA =
  '=ARRAYFORMULA(IF(A2:A="","",REGEXREPLACE(' +
  CHANNELS.map((c, i) => {
    const col = String.fromCharCode(67 + i) // C, D, E, F, G
    return `IF(${col}2:${col}="","","${c.prefix}: "&${col}2:${col}&" · ")`
  }).join('&') +
  ',"( · )+$","")))'

const COLUMN_WIDTHS = [
  250,                       // name
  120,                       // Stage
  110, 110, 110, 110, 110,   // five channels
  260,                       // Outreach
  72,                        // Priority
  280,                       // Notes
]

const border = (color: string) => Object.fromEntries(
  ['top', 'bottom', 'left', 'right'].map((k) => [k, { style: 'SOLID', color: rgb(color) }]),
)

/** Everything needed to turn a bare tab into a styled Atlas lead tab. */
export function buildTemplateRequests(sheetId: number): unknown[] {
  const width = TEMPLATE_HEADERS.length
  const reqs: unknown[] = []

  // Header row
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb(NAVY),
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { foregroundColor: rgb('#ffffff'), bold: true, fontSize: 11 },
          borders: border(HEADER_BORDER),
        },
      },
      fields: 'userEnteredFormat',
    },
  })

  // Body rows
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: width },
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { foregroundColor: rgb(BODY_FG), fontSize: 10, bold: false },
        },
      },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)',
    },
  })

  // Stage + channels centred
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 7 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  })

  // Freeze header row and name column
  reqs.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
        tabColor: rgb(NAVY),
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColor',
    },
  })

  // Column widths
  COLUMN_WIDTHS.forEach((pixelSize, i) => reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }))

  // Dropdowns: Stage (B), each channel (C..G), Priority (I)
  const dropdown = (colIndex: number, values: string[]) => ({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
        strict: true,
        showCustomUi: true,
      },
    },
  })
  reqs.push(dropdown(1, STAGE_VALUES))
  CHANNELS.forEach((c, i) => reqs.push(dropdown(2 + i, c.values)))
  reqs.push(dropdown(TEMPLATE_HEADERS.indexOf('Priority'), PRIORITY_VALUES))

  // Stage colours
  let ruleIndex = 0
  for (const value of STAGE_VALUES) {
    const [bg, fg] = STAGE_COLOURS[value]
    reqs.push({
      addConditionalFormatRule: {
        index: ruleIndex++,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
            format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg), bold: true } },
          },
        },
      },
    })
  }

  // Four outcome rules spanning the whole C:G channel block
  for (const oc of OUTCOME_COLOURS) {
    const list = oc.values.map((v) => `"${v}"`).join(',')
    reqs.push({
      addConditionalFormatRule: {
        index: ruleIndex++,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 7 }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=MATCH(C2,{${list}},0)` }] },
            format: { backgroundColor: rgb(oc.bg), textFormat: { foregroundColor: rgb(oc.fg), bold: true } },
          },
        },
      },
    })
  }

  // Priority colours
  const priorityCol = TEMPLATE_HEADERS.indexOf('Priority')
  PRIORITY_VALUES.forEach((value, i) => reqs.push({
    addConditionalFormatRule: {
      index: ruleIndex++,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: priorityCol, endColumnIndex: priorityCol + 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          format: { backgroundColor: rgb(PRIORITY_COLOURS[i]), textFormat: { foregroundColor: rgb('#ffffff'), bold: true } },
        },
      },
    },
  }))

  return reqs
}
