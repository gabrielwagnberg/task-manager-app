const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Columns the Shopping sheet must have ('Project' added for the Projects feature).
const REQUIRED_HEADERS = [
  'Item ID', 'Item Name', 'Category', 'Purchased', 'Owner', 'Shared', 'Project',
];

// Append any missing required columns to the header row (preserves existing
// columns/data). Call BEFORE getRows() so row objects map the new columns correctly.
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
      const sheet = doc.sheetsByTitle['Shopping'];
      const rows = await sheet.getRows();

      const visibleRows = rows.filter(row => {
        const isShared = row.get('Shared') === 'TRUE' || row.get('Shared') === true;
        const isOwner = row.get('Owner') === user;
        return isShared || isOwner;
      });

      const items = visibleRows.map(row => ({
        id: row.get('Item ID'),
        name: row.get('Item Name'),
        category: row.get('Category'),
        purchased: row.get('Purchased') === 'TRUE' || row.get('Purchased') === true,
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE' || row.get('Shared') === true,
        project: row.get('Project') || '',
      }));

      return res.status(200).json(items);
    }

    if (method === 'POST') {
      const { name, category, owner, shared, project } = req.body;

      if (!name || !category) {
        return res.status(400).json({ error: 'Item name and category are required' });
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Shopping'];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Item ID')) || 0), 0);
      const newId = maxId + 1;

      await sheet.addRow({
        'Item ID': newId,
        'Item Name': name,
        'Category': category,
        'Purchased': 'FALSE',
        'Owner': owner || '',
        'Shared': shared ? 'TRUE' : 'FALSE',
        'Project': project || '',
      });

      return res.status(201).json({ id: newId, name, category, purchased: false, owner, shared, project: project || '' });
    }

    if (method === 'PUT') {
      const body = req.body;
      const { id } = body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Shopping'];
      await ensureHeaders(sheet);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Item ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Item not found' });
      }

      // ── Full edit (name present in body) ──────────────────────────────────
      if (typeof body.name !== 'undefined') {
        const { name, category, shared, project } = body;
        if (name !== undefined) row.set('Item Name', name);
        if (category !== undefined) row.set('Category', category);
        if (shared !== undefined) row.set('Shared', shared ? 'TRUE' : 'FALSE');
        if (project !== undefined) row.set('Project', project || '');
        await row.save();

        return res.status(200).json({
          id,
          name: row.get('Item Name'),
          category: row.get('Category'),
          purchased: row.get('Purchased') === 'TRUE',
          owner: row.get('Owner') || '',
          shared: row.get('Shared') === 'TRUE',
          project: row.get('Project') || '',
        });
      }

      // ── Toggle purchased ──────────────────────────────────────────────────
      const { purchased } = body;
      row.set('Purchased', purchased ? 'TRUE' : 'FALSE');
      await row.save();

      return res.status(200).json({ id, purchased });
    }

    if (method === 'DELETE') {
      const { id } = req.body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Shopping'];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Item ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Item not found' });
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
