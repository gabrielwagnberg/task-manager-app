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

// Today as YYYY-MM-DD (server timezone — Netlify runs UTC).
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

// Columns the Tasks sheet must have. Recurrence added the last four.
const REQUIRED_HEADERS = [
  'Task ID', 'Task Name', 'Completed', 'Due Date', 'Owner', 'Shared',
  'Frequency', 'Rate', 'Last Done', 'Next Due',
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
  const sheetId = '1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg'; // Your sheet ID

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

// Main handler — routes requests based on HTTP method
exports.handler = async (event, context) => {
  const method = event.httpMethod;

  try {
    if (method === 'GET') {
      // Get all tasks visible to the current user
      const user = event.queryStringParameters?.user;
      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      // Filter: show if shared OR user is the owner
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
      }));

      return {
        statusCode: 200,
        body: JSON.stringify(tasks),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'POST') {
      // Add a new task
      const { name, dueDate, owner, shared, recurring, frequency, rate } = JSON.parse(event.body);

      if (!name) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Task name is required' }),
        };
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Task ID')) || 0), 0);
      const newId = maxId + 1;

      // Recurring task: seed Last Done = today, Next Due = today + interval.
      // The manual Due Date is ignored for recurring tasks (Next Due drives it).
      const isRecurring = !!recurring && !!frequency;
      const recurRate = rate || 'days';
      const lastDone = isRecurring ? todayStr() : '';
      const nextDue = isRecurring ? computeNextDue(lastDone, frequency, recurRate) : '';

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
      });

      return {
        statusCode: 201,
        body: JSON.stringify({
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
        }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'PUT') {
      // Update a task (toggle completed)
      const { id, completed } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Task not found' }),
        };
      }

      // Recurring task checked off: don't complete it — reset the cycle.
      // Last Done = today, Next Due recalculated, stays incomplete.
      if (rowIsRecurring(row) && completed) {
        const today = todayStr();
        const rate = row.get('Rate') || 'days';
        const frequency = row.get('Frequency');
        const nextDue = computeNextDue(today, frequency, rate);

        row.set('Last Done', today);
        row.set('Next Due', nextDue);
        row.set('Completed', 'FALSE');
        await row.save();

        return {
          statusCode: 200,
          body: JSON.stringify({ id, completed: false, recurring: true, lastDone: today, nextDue }),
          headers: { 'Content-Type': 'application/json' },
        };
      }

      row.set('Completed', completed ? 'TRUE' : 'FALSE');
      await row.save();

      return {
        statusCode: 200,
        body: JSON.stringify({ id, completed }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'DELETE') {
      // Delete a task
      const { id } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Task ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Task not found' }),
        };
      }

      await row.delete();

      return {
        statusCode: 200,
        body: JSON.stringify({ id }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error: ' + error.message }),
    };
  }
};
