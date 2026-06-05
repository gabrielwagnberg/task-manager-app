const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const initializeSheet = async () => {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const doc = new GoogleSpreadsheet('1PVqagEBrE27H7H9ljZ9GX8dSUDU-d85YKWjx7mRItjg');
  doc.auth = auth;
  await doc.loadInfo();
  return doc;
};

// Auto-creates the sheet and seeds an empty row if needed.
const ensureSheet = async (doc) => {
  let sheet = doc.sheetsByTitle['Whiteboard'];
  if (!sheet) {
    sheet = await doc.addSheet({
      title: 'Whiteboard',
      headerValues: ['Content', 'Last Edited', 'Last Editor'],
    });
    await sheet.addRow({ Content: '', 'Last Edited': new Date().toISOString(), 'Last Editor': '' });
    return sheet;
  }
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  if (rows.length === 0) {
    await sheet.addRow({ Content: '', 'Last Edited': new Date().toISOString(), 'Last Editor': '' });
  }
  return sheet;
};

module.exports = async (req, res) => {
  try {
    const doc   = await initializeSheet();
    const sheet = await ensureSheet(doc);

    // ── GET: return current content ──────────────────────────────────────────
    if (req.method === 'GET') {
      const rows = await sheet.getRows();
      const row  = rows[0];
      return res.status(200).json({
        content:    row.get('Content')     || '',
        lastEdited: row.get('Last Edited') || '',
        lastEditor: row.get('Last Editor') || '',
      });
    }

    // ── PUT: overwrite content ───────────────────────────────────────────────
    if (req.method === 'PUT') {
      const { content = '', editor = '' } = req.body;
      const rows = await sheet.getRows();
      const row  = rows[0];
      const now  = new Date().toISOString();
      row.set('Content',     content);
      row.set('Last Edited', now);
      row.set('Last Editor', editor);
      await row.save();
      return res.status(200).json({ content, lastEdited: now, lastEditor: editor });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Whiteboard error:', err);
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
