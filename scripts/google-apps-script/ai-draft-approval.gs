/**
 * MedSwipe AI draft approval workflow.
 *
 * Paste this module into the same bound Apps Script project that contains
 * syncQuestions_WithDelete_And_Procedures(). It does not call the Firestore
 * sync; it only promotes reviewed draft rows into ENT_Quiz_Facts.
 */

const MEDSWIPE_AI_DRAFTS_CONFIG = {
  draftSheetName: 'AI_Drafts',
  masterSheetName: 'ENT_Quiz_Facts',
  approveHeader: 'Approve',
  statusHeader: 'Review Status',
  reviewerNotesHeader: 'Reviewer Notes',
  promotedAtHeader: 'Promoted At',
  promotedRowHeader: 'Promoted Row',
  batchIdHeader: 'Batch ID',
  sourceGuidelineHeader: 'Source/Guideline',
  docIdHeader: 'DocID',
  promotedStatus: 'Promoted',
  needsRevisionStatus: 'Needs Revision',
  requiredHeaders: [
    'Question',
    'Option A',
    'Option B',
    'Correct Answer',
    'Explanation',
    'Category',
    'Specialty'
  ]
};

/**
 * Installs or repairs the AI_Drafts sheet.
 *
 * Run this manually once from Apps Script after pasting this file.
 */
function setupAiDraftReviewSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = MEDSWIPE_AI_DRAFTS_CONFIG;
  const masterSheet = ss.getSheetByName(config.masterSheetName);
  if (!masterSheet) throw new Error(`Sheet "${config.masterSheetName}" not found.`);

  const masterHeaders = getHeaderRow_(masterSheet);
  if (masterHeaders.length === 0) {
    throw new Error(`Sheet "${config.masterSheetName}" must have headers in row 1.`);
  }

  let draftSheet = ss.getSheetByName(config.draftSheetName);
  if (!draftSheet) {
    draftSheet = ss.insertSheet(config.draftSheetName);
  }

  const reviewHeaders = getAiDraftReviewHeaders_();
  const desiredHeaders = reviewHeaders.concat(
    masterHeaders.filter((header) => header && reviewHeaders.indexOf(header) === -1)
  );

  const existingHeaders = getHeaderRow_(draftSheet);
  if (existingHeaders.length === 0) {
    draftSheet.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
  } else {
    const headersToAppend = desiredHeaders.filter(
      (header) => header && existingHeaders.indexOf(header) === -1
    );
    if (headersToAppend.length > 0) {
      draftSheet
        .getRange(1, existingHeaders.length + 1, 1, headersToAppend.length)
        .setValues([headersToAppend]);
    }
  }

  formatAiDraftReviewSheet_(draftSheet);
}

/**
 * Handles approval checkboxes in AI_Drafts.
 *
 * If this Apps Script project already has an onEdit(e), call
 * handleAiDraftApprovalEdit(e) from that existing function instead of keeping
 * two separate onEdit definitions.
 */
function onEdit(e) {
  handleAiDraftApprovalEdit(e);
}

function handleAiDraftApprovalEdit(e) {
  if (!e || !e.range) return;

  const config = MEDSWIPE_AI_DRAFTS_CONFIG;
  const editedSheet = e.range.getSheet();
  if (editedSheet.getName() !== config.draftSheetName) return;
  if (e.range.getRow() <= 1 || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const draftHeaders = getHeaderRow_(editedSheet);
  const draftIndex = buildHeaderIndex_(draftHeaders);
  const approveIndex = draftIndex[config.approveHeader];
  if (approveIndex === undefined || e.range.getColumn() !== approveIndex + 1) return;
  if (!isApprovalValue_(e.value)) return;

  const promotedAtIndex = requireHeader_(draftIndex, config.promotedAtHeader, config.draftSheetName);
  const rowNumber = e.range.getRow();
  const promotedAt = editedSheet.getRange(rowNumber, promotedAtIndex + 1).getValue();
  if (promotedAt) return;

  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    setDraftStatus_(editedSheet, rowNumber, draftIndex, config.needsRevisionStatus, 'Approval skipped: could not acquire document lock. Try again.');
    e.range.setValue(false);
    return;
  }

  try {
    promoteAiDraftRow_(editedSheet, rowNumber);
  } catch (err) {
    const latestHeaders = getHeaderRow_(editedSheet);
    const latestIndex = buildHeaderIndex_(latestHeaders);
    setDraftStatus_(editedSheet, rowNumber, latestIndex, config.needsRevisionStatus, String(err.message || err));
    e.range.setValue(false);
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function promoteAiDraftRow_(draftSheet, rowNumber) {
  const ss = draftSheet.getParent();
  const config = MEDSWIPE_AI_DRAFTS_CONFIG;
  const masterSheet = ss.getSheetByName(config.masterSheetName);
  if (!masterSheet) throw new Error(`Sheet "${config.masterSheetName}" not found.`);

  const draftHeaders = getHeaderRow_(draftSheet);
  const masterHeaders = getHeaderRow_(masterSheet);
  const draftIndex = buildHeaderIndex_(draftHeaders);
  const masterIndex = buildHeaderIndex_(masterHeaders);

  requireHeader_(draftIndex, config.promotedAtHeader, config.draftSheetName);
  requireHeader_(draftIndex, config.promotedRowHeader, config.draftSheetName);
  requireHeader_(draftIndex, config.statusHeader, config.draftSheetName);

  config.requiredHeaders.forEach((header) => {
    requireHeader_(draftIndex, header, config.draftSheetName);
    requireHeader_(masterIndex, header, config.masterSheetName);
  });

  const promotedAtIndex = draftIndex[config.promotedAtHeader];
  if (draftSheet.getRange(rowNumber, promotedAtIndex + 1).getValue()) return;

  const rowValues = draftSheet.getRange(rowNumber, 1, 1, draftHeaders.length).getValues()[0];
  const missingHeaders = config.requiredHeaders.filter((header) => !normalizeString_(rowValues[draftIndex[header]]));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required draft field(s): ${missingHeaders.join(', ')}`);
  }

  const appendValues = masterHeaders.map((header) => {
    if (header === config.docIdHeader) return '';
    const draftColumn = draftIndex[header];
    return draftColumn === undefined ? '' : rowValues[draftColumn];
  });

  const appendedRow = Math.max(masterSheet.getLastRow() + 1, 2);
  masterSheet.getRange(appendedRow, 1, 1, appendValues.length).setValues([appendValues]);

  const now = new Date();
  draftSheet.getRange(rowNumber, draftIndex[config.statusHeader] + 1).setValue(config.promotedStatus);
  draftSheet.getRange(rowNumber, promotedAtIndex + 1).setValue(now);
  draftSheet.getRange(rowNumber, draftIndex[config.promotedRowHeader] + 1).setValue(appendedRow);

  const notesIndex = draftIndex[config.reviewerNotesHeader];
  if (notesIndex !== undefined && !normalizeString_(rowValues[notesIndex])) {
    draftSheet.getRange(rowNumber, notesIndex + 1).setValue(`Promoted to ${config.masterSheetName} row ${appendedRow}.`);
  }
}

function formatAiDraftReviewSheet_(sheet) {
  const headers = getHeaderRow_(sheet);
  const index = buildHeaderIndex_(headers);
  const maxRows = Math.max(sheet.getMaxRows(), 1000);

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');

  const approveIndex = index[MEDSWIPE_AI_DRAFTS_CONFIG.approveHeader];
  if (approveIndex !== undefined) {
    sheet.getRange(2, approveIndex + 1, maxRows - 1, 1).insertCheckboxes();
  }

  const statusIndex = index[MEDSWIPE_AI_DRAFTS_CONFIG.statusHeader];
  if (statusIndex !== undefined) {
    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['Draft', 'Approved', 'Rejected', 'Needs Revision', 'Promoted'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(2, statusIndex + 1, maxRows - 1, 1).setDataValidation(rule);
  }

  const promotedAtIndex = index[MEDSWIPE_AI_DRAFTS_CONFIG.promotedAtHeader];
  if (promotedAtIndex !== undefined) {
    sheet.getRange(2, promotedAtIndex + 1, maxRows - 1, 1).setNumberFormat('yyyy-mm-dd hh:mm');
  }

  sheet.autoResizeColumns(1, headers.length);
}

function setDraftStatus_(sheet, rowNumber, headerIndex, status, note) {
  const config = MEDSWIPE_AI_DRAFTS_CONFIG;
  if (headerIndex[config.statusHeader] !== undefined) {
    sheet.getRange(rowNumber, headerIndex[config.statusHeader] + 1).setValue(status);
  }
  if (headerIndex[config.reviewerNotesHeader] !== undefined) {
    sheet.getRange(rowNumber, headerIndex[config.reviewerNotesHeader] + 1).setValue(note);
  }
}

function getAiDraftReviewHeaders_() {
  const config = MEDSWIPE_AI_DRAFTS_CONFIG;
  return [
    config.approveHeader,
    config.statusHeader,
    config.reviewerNotesHeader,
    config.promotedAtHeader,
    config.promotedRowHeader,
    config.batchIdHeader,
    config.sourceGuidelineHeader
  ];
}

function getHeaderRow_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn === 0) return [];
  const headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map((value) => normalizeString_(value));

  while (headers.length > 0 && headers[headers.length - 1] === null) {
    headers.pop();
  }

  return headers;
}

function buildHeaderIndex_(headers) {
  const index = {};
  headers.forEach((header, i) => {
    if (header) index[header] = i;
  });
  return index;
}

function requireHeader_(headerIndex, header, sheetName) {
  if (headerIndex[header] === undefined) {
    throw new Error(`Missing required header "${header}" on sheet "${sheetName}".`);
  }
  return headerIndex[header];
}

function isApprovalValue_(value) {
  if (value === true) return true;
  if (value === 'TRUE') return true;
  if (value === 'true') return true;
  return false;
}

function normalizeString_(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}
