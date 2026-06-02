const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const PROJECT_HEADERS = ['Project ID', 'Name', 'Owner', 'Shared', 'Description'];

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

// Get the Projects tab, creating it (with headers) if it doesn't exist yet.
const getProjectsSheet = async (doc) => {
  let sheet = doc.sheetsByTitle['Projects'];
  if (!sheet) {
    sheet = await doc.addSheet({ title: 'Projects', headerValues: PROJECT_HEADERS });
    return sheet;
  }
  try {
    await sheet.loadHeaderRow();
    const existing = sheet.headerValues || [];
    const missing = PROJECT_HEADERS.filter(h => !existing.includes(h));
    if (missing.length > 0) {
      await sheet.setHeaderRow([...existing, ...missing]);
    }
  } catch (e) {
    await sheet.setHeaderRow(PROJECT_HEADERS);
  }
  return sheet;
};

// Resolve the Tasks / Shopping sheets (Tasks is index 0, titled 'Tasks').
const getItemSheets = (doc) => [
  doc.sheetsByTitle['Tasks'] || doc.sheetsByIndex[0],
  doc.sheetsByTitle['Shopping'],
].filter(Boolean);

// Apply a project deletion to one item sheet: either delete the tagged rows
// or just clear their Project tag. Deletes bottom-up so row numbers stay valid.
const applyToItemSheet = async (sheet, projectId, deleteItems) => {
  const rows = await sheet.getRows();
  const matched = rows.filter(r => String(r.get('Project') || '') === String(projectId));
  if (matched.length === 0) return 0;

  if (deleteItems) {
    matched.sort((a, b) => b.rowNumber - a.rowNumber);
    for (const r of matched) {
      await r.delete();
    }
  } else {
    for (const r of matched) {
      r.set('Project', '');
      await r.save();
    }
  }
  return matched.length;
};

// Main handler — Vercel serverless function
module.exports = async (req, res) => {
  const method = req.method;

  try {
    if (method === 'GET') {
      const user = req.query.user;
      const doc = await initializeSheet();
      const sheet = await getProjectsSheet(doc);
      const rows = await sheet.getRows();

      const visibleRows = rows.filter(row => {
        const isShared = row.get('Shared') === 'TRUE' || row.get('Shared') === true;
        const isOwner = row.get('Owner') === user;
        return isShared || isOwner;
      });

      const projects = visibleRows.map(row => ({
        id: row.get('Project ID'),
        name: row.get('Name'),
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE' || row.get('Shared') === true,
        description: row.get('Description') || '',
      }));

      return res.status(200).json(projects);
    }

    if (method === 'POST') {
      const { name, owner, shared, description } = req.body;

      if (!name) {
        return res.status(400).json({ error: 'Project name is required' });
      }

      const doc = await initializeSheet();
      const sheet = await getProjectsSheet(doc);
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Project ID')) || 0), 0);
      const newId = maxId + 1;

      await sheet.addRow({
        'Project ID': newId,
        'Name': name,
        'Owner': owner || '',
        'Shared': shared ? 'TRUE' : 'FALSE',
        'Description': description || '',
      });

      return res.status(201).json({ id: newId, name, owner, shared, description: description || '' });
    }

    if (method === 'PUT') {
      const { id, name, shared, description } = req.body;

      const doc = await initializeSheet();
      const sheet = await getProjectsSheet(doc);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Project ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Project not found' });
      }

      if (typeof name === 'string' && name.trim() !== '') {
        row.set('Name', name.trim());
      }
      if (typeof shared === 'boolean') {
        row.set('Shared', shared ? 'TRUE' : 'FALSE');
      }
      if (typeof description === 'string') {
        row.set('Description', description);
      }
      await row.save();

      return res.status(200).json({
        id,
        name: row.get('Name'),
        shared: row.get('Shared') === 'TRUE',
        description: row.get('Description') || '',
      });
    }

    if (method === 'DELETE') {
      const { id, deleteItems } = req.body;

      const doc = await initializeSheet();
      const sheet = await getProjectsSheet(doc);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Project ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Project not found' });
      }

      let affected = 0;
      for (const itemSheet of getItemSheets(doc)) {
        affected += await applyToItemSheet(itemSheet, id, !!deleteItems);
      }

      await row.delete();

      return res.status(200).json({ id, deletedItems: !!deleteItems, affected });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
