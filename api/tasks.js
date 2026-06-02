const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// ===== Recurrence date helpers =====

// Format a Date object as a YYYY-MM-DD string.
const toDateStr = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Today as YYYY-MM-DD (server timezone — Vercel runs UTC).
const todayStr = () => toDateStr(new Date());

// Add frequency × rate to a YYYY-MM-DD date string and return YYYY-MM-DD.
// rate: 'days' | 'weeks' | 'months'
const computeNextDue = (lastDone, frequency, rate) => {
  const [y, m, d] = String(lastDone).split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const n = parseInt(frequency, 10) || 1;
  if (rate === 'weeks') {
    date.setDate(date.getDate() + n * 7);
  } else if (rate === 'months') {
    // Add n months, clamping the day to the last valid day of the target
    // month (so May 31 + 1 month = June 30, not July 1).
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() + n);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  } else {
    // default: days
    date.setDate(date.getDate() + n);
  }
  return toDateStr(date);
};

// A row is recurring when it has a Frequency set.
const rowIsRecurring = (row) => {
  const freq = row.get('Frequency');
  return freq !== undefined && freq !== null && String(freq).trim() !== '';
};

// Columns the Tasks sheet must have. Recurrence added the last four; Priority added later.
const REQUIRED_HEADERS = [
  'Task ID', 'Task Name', 'Completed', 'Due Date', 'Owner', 'Shared',
  'Frequency', 'Rate', 'Last Done', 'Next Due', 'Project', 'Priority', 'Assigned To',
];

// Make sure every required column exists in the header row, appending any
// that are missing (preserves existing columns/data). Lets the recurrence
// feature work without manually editing the Google Sheet. Call this BEFORE
// getRows() so row objects map the new columns correctly.
const ensureHeaders = async (sheet) => {
  await sheet.loadHeaderRow();
  const existing = sheet.headerValues || [];
  const missing = REQUIRED_HEADERS.filter(h => !existing.includes(h));
  if (missing.length > 0) {
    await sheet.setHeaderRow([...existing, ...missing]);
  }
};

// Initialize the Google Sheet
const initializeSheet = async () => {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) {
    throw new Error('GOOGLE_CREDENTIALS environment variable not set');
  }

  const credentials = JSON.parse(credentialsJson);
  const sheetId = '1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg';

  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const doc = new GoogleSpreadsheet(sheetId);
  doc.auth = auth;

  await doc.loadInfo();

  return doc;
};

// Main handler — Vercel serverless function
module.exports = async (req, res) => {
  const method = req.method;

  try {
    if (method === 'GET') {
      const user = req.query.user;
      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const visibleRows = rows.filter(row => {
        const isShared = row.get('Shared') === 'TRUE' || row.get('Shared') === true;
        const isOwner = row.get('Owner') === user;
        return isShared || isOwner;
      });

      const tasks = visibleRows.map(row => ({
        id: row.get('Task ID'),
        name: row.get('Task Name'),
        completed: row.get('Completed') === 'TRUE' || row.get('Completed') === true,
        dueDate: row.get('Due Date') || '',
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE' || row.get('Shared') === true,
        recurring: rowIsRecurring(row),
        frequency: row.get('Frequency') || '',
        rate: row.get('Rate') || '',
        lastDone: row.get('Last Done') || '',
        nextDue: row.get('Next Due') || '',
        project: row.get('Project') || '',
        priority: row.get('Priority') || '',
        assignedTo: row.get('Assigned To') || '',
      }));

      return res.status(200).json(tasks);
    }

    if (method === 'POST') {
      const { name, dueDate, owner, shared, recurring, frequency, rate, project, priority, assignedTo, nextDue: nextDueOverride } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Task name is required' });
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Task ID')) || 0), 0);
      const newId = maxId + 1;

      const isRecurring = !!recurring && !!frequency;
      const recurRate = rate || 'days';
      const lastDone = isRecurring ? todayStr() : '';
      const providedNextDue = nextDueOverride && String(nextDueOverride).trim() ? String(nextDueOverride).trim() : null;
      const nextDue = isRecurring
        ? (providedNextDue || computeNextDue(lastDone, frequency, recurRate))
        : '';

      await sheet.addRow({
        'Task ID': newId,
        'Task Name': name,
        'Completed': 'FALSE',
        'Due Date': isRecurring ? '' : (dueDate || ''),
        'Owner': owner || '',
        'Shared': shared ? 'TRUE' : 'FALSE',
        'Frequency': isRecurring ? frequency : '',
        'Rate': isRecurring ? recurRate : '',
        'Last Done': lastDone,
        'Next Due': nextDue,
        'Project': project || '',
        'Priority': priority || '',
        'Assigned To': assignedTo || '',
      });

      return res.status(201).json({
        id: newId,
        name,
        completed: false,
        dueDate: isRecurring ? '' : (dueDate || ''),
        owner,
        shared,
        recurring: isRecurring,
        frequency: isRecurring ? frequency : '',
        rate: isRecurring ? recurRate : '',
        lastDone,
        nextDue,
        project: project || '',
        priority: priority || '',
        assignedTo: assignedTo || '',
      });
    }

    if (method === 'PUT') {
      const body = req.body;
      const { id } = body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Task not found' });
      }

      // ── Full edit (name present in body) ──────────────────────────────────
      if (typeof body.name !== 'undefined') {
        const { name, dueDate, shared, recurring, frequency, rate, project, priority, assignedTo, nextDue: nextDueOverride } = body;

        if (name !== undefined) row.set('Task Name', name);
        if (shared !== undefined) row.set('Shared', shared ? 'TRUE' : 'FALSE');
        if (project !== undefined) row.set('Project', project || '');
        if (priority !== undefined) row.set('Priority', priority || '');
        if (assignedTo !== undefined) row.set('Assigned To', assignedTo || '');

        const isRecurring = !!recurring && !!frequency;
        if (isRecurring) {
          const recurRate = rate || 'days';
          row.set('Frequency', frequency);
          row.set('Rate', recurRate);
          row.set('Due Date', '');
          const providedNextDue = nextDueOverride && String(nextDueOverride).trim() ? String(nextDueOverride).trim() : null;
          if (providedNextDue) {
            row.set('Next Due', providedNextDue);
          } else {
            const lastDone = row.get('Last Done') || todayStr();
            row.set('Last Done', lastDone);
            row.set('Next Due', computeNextDue(lastDone, frequency, recurRate));
          }
        } else {
          row.set('Frequency', '');
          row.set('Rate', '');
          row.set('Last Done', '');
          row.set('Next Due', '');
          row.set('Due Date', dueDate || '');
        }

        await row.save();

        return res.status(200).json({
          id,
          name: row.get('Task Name'),
          completed: row.get('Completed') === 'TRUE',
          dueDate: row.get('Due Date') || '',
          owner: row.get('Owner') || '',
          shared: row.get('Shared') === 'TRUE',
          recurring: isRecurring,
          frequency: row.get('Frequency') || '',
          rate: row.get('Rate') || '',
          lastDone: row.get('Last Done') || '',
          nextDue: row.get('Next Due') || '',
          project: row.get('Project') || '',
          priority: row.get('Priority') || '',
          assignedTo: row.get('Assigned To') || '',
        });
      }

      // ── Toggle completed ──────────────────────────────────────────────────
      const { completed } = body;

      if (rowIsRecurring(row) && completed) {
        const today = todayStr();
        const rate = row.get('Rate') || 'days';
        const frequency = row.get('Frequency');
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const nextDue = computeNextDue(toDateStr(tomorrow), frequency, rate);

        row.set('Last Done', today);
        row.set('Next Due', nextDue);
        row.set('Completed', 'FALSE');
        await row.save();

        return res.status(200).json({ id, completed: false, recurring: true, lastDone: today, nextDue });
      }

      row.set('Completed', completed ? 'TRUE' : 'FALSE');
      await row.save();

      return res.status(200).json({ id, completed });
    }

    if (method === 'DELETE') {
      const { id } = req.body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Task not found' });
      }

      await row.delete();

      return res.status(200).json({ id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
