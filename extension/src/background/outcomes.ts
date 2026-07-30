import { columnLetter } from '../sheets/mapping'
import type { HeaderMapping } from '../sheets/mapping'
import type { CallOutcome, Lead } from '../shared/types'

/**
 * Outcome write-back plumbing (ARCHITECTURE §5.4, story 09). Pure helpers
 * here; the network calls live in the interpreter. Story 10 moves execution
 * behind the durable queue — the shapes stay the same.
 */

export interface PendingWrite {
  rowIndex: number
  /** Loaded name — the stale-row guard compares it before any write. */
  leadName: string
  outcome: CallOutcome
  note?: string
}

/** A1 cells for one lead row, resolved from the header mapping (never position). */
export function outcomeCells(mapping: HeaderMapping, rowIndex: number) {
  return {
    nameCell: `${columnLetter(mapping.nameCol)}${rowIndex}`,
    callStatusCell: `${columnLetter(mapping.callStatusCol)}${rowIndex}`,
    notesCell: mapping.notesCol !== null
      ? `${columnLetter(mapping.notesCol)}${rowIndex}`
      : null,
  }
}

/** Date-prefixed note appended after any existing cell content (UX S5.3). */
export function notesAppend(existing: string, note: string, dateIso: string): string {
  const stamped = `${dateIso.slice(0, 10)}: ${note.trim()}`
  const current = existing.trim()
  return current ? `${current}\n${stamped}` : stamped
}

/**
 * Story 15: fold the recording basename into the outcome's note. The filename
 * rides the EXISTING Notes write (single-cell RAW, undo-covered) — no new
 * write shape, and no write at all when there's neither note nor recording.
 */
export function withRecordingNote(
  note: string | undefined,
  recordingFile: string | undefined,
): string | undefined {
  if (!recordingFile) return note
  const tag = `🎙 ${recordingFile}`
  return note?.trim() ? `${note.trim()}\n${tag}` : tag
}

/**
 * The stale-row guard: names must match (whitespace-insensitively) or the
 * sheet was re-sorted and every cursor is invalid — a wrong write is worse
 * than a missed one.
 */
export function namesMatch(loaded: string, current: string): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  return norm(loaded) === norm(current)
}

/** Apply a completed write to the in-memory lead so the retry filter and history strip stay fresh. */
export function applyWriteToLead(lead: Lead, write: PendingWrite, dateIso: string): Lead {
  return {
    ...lead,
    callStatus: write.outcome,
    notes: write.note ? notesAppend(lead.notes ?? '', write.note, dateIso) : lead.notes,
  }
}

export const SHEET_CHANGED_ERROR =
  "The sheet's rows moved — statuses could land on the wrong business. Reload the tab."
