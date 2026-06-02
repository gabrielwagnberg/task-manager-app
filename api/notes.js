const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

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

// Ensure the Notes sheet has all required columns (auto-provisions new ones).
const ensureNotesHeaders = async (sheet) => {
  await sheet.loadHeaderRow();
  const existing = sheet.headerValues || [];
  const required = ['Note ID', 'Note', 'Date Created', 'Owner', 'Shared', 'Project', 'Subject', 'Last Edited'];
  const missing = required.filter(h => !existing.includes(h));
  if (missing.length > 0) {
    await sheet.setHeaderRow([...existing, ...missing]);
  }
};

// Main handler — Vercel serverless function
module.exports = async (req, res) => {
  const method = req.method;

  try {
    if (method === 'GET') {
      const user = req.query.user;
      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      await ensureNotesHeaders(sheet);
      const rows = await sheet.getRows();

      const visibleRows = rows.filter(row => {
        const isShared = row.get('Shared') === 'TRUE' || row.get('Shared') === true;
        const isOwner = row.get('Owner') === user;
        return isShared || isOwner;
      });

      const notes = visibleRows.map(row => ({
        id: row.get('Note ID'),
        subject: row.get('Subject') || '',
        content: row.get('Note'),
        dateCreated: row.get('Date Created'),
        lastEdited: row.get('Last Edited') || row.get('Date Created'),
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE' || row.get('Shared') === true,
        project: row.get('Project') || '',
      }));

      return res.status(200).json(notes);
    }

    if (method === 'POST') {
      const { subject, content, owner, shared, project } = req.body;

      if (!content) {
        return res.status(400).json({ error: 'Note content is required' });
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      await ensureNotesHeaders(sheet);
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Note ID')) || 0), 0);
      const newId = maxId + 1;

      const now = new Date().toISOString();

      await sheet.addRow({
        'Note ID': newId,
        'Subject': subject || '',
        'Note': content,
        'Date Created': now,
        'Last Edited': now,
        'Owner': owner || '',
        'Shared': shared ? 'TRUE' : 'FALSE',
        'Project': project || '',
      });

      return res.status(201).json({ id: newId, subject: subject || '', content, dateCreated: now, lastEdited: now, owner, shared, project: project || '' });
    }

    if (method === 'PUT') {
      const { id, subject, content, shared, project } = req.body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      await ensureNotesHeaders(sheet);
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Note ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Note not found' });
      }

      const now = new Date().toISOString();

      if (subject !== undefined) row.set('Subject', subject || '');
      if (content !== undefined) row.set('Note', content);
      if (shared !== undefined) row.set('Shared', shared ? 'TRUE' : 'FALSE');
      if (project !== undefined) row.set('Project', project || '');
      row.set('Last Edited', now);
      await row.save();

      return res.status(200).json({
        id,
        subject: row.get('Subject') || '',
        content: row.get('Note'),
        dateCreated: row.get('Date Created'),
        lastEdited: now,
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE',
        project: row.get('Project') || '',
      });
    }

    if (method === 'DELETE') {
      const { id } = req.body;

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Note ID') == id);

      if (!row) {
        return res.status(404).json({ error: 'Note not found' });
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
