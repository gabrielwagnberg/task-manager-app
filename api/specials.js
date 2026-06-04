const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const BIRTHDAY_HEADERS    = ['Birthday ID', 'Name', 'Date', 'Owner', 'Shared', 'Notes'];
const SPECIAL_DAY_HEADERS = ['Day ID', 'Name', 'Date', 'Recurring', 'Owner', 'Shared', 'Notes'];

const ensureHeaders = async (sheet, required) => {
  await sheet.loadHeaderRow();
  const existing = sheet.headerValues || [];
  const missing = required.filter(h => !existing.includes(h));
  if (missing.length > 0) await sheet.setHeaderRow([...existing, ...missing]);
};

const initializeDoc = async () => {
  const credentialsJson = process.env.GOOGLE_CREDENTIALS;
  if (!credentialsJson) throw new Error('GOOGLE_CREDENTIALS not set');
  const credentials = JSON.parse(credentialsJson);
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

const getOrCreateSheet = async (doc, title, headers) => {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) sheet = await doc.addSheet({ title, headerValues: headers });
  return sheet;
};

module.exports = async (req, res) => {
  const method = req.method;
  try {
    const doc = await initializeDoc();

    // ── GET: return birthdays and special days visible to the user ──────────
    if (method === 'GET') {
      const user = req.query.user || '';

      const bdaySheet = await getOrCreateSheet(doc, 'Birthdays', BIRTHDAY_HEADERS);
      const specSheet = await getOrCreateSheet(doc, 'Special Days', SPECIAL_DAY_HEADERS);
      await ensureHeaders(bdaySheet, BIRTHDAY_HEADERS);
      await ensureHeaders(specSheet, SPECIAL_DAY_HEADERS);

      const bdayRows = await bdaySheet.getRows();
      const specRows = await specSheet.getRows();

      // Visibility rule: shared items are visible to everyone; private items
      // (Shared = FALSE) are visible only to their owner. Items with no owner
      // are legacy rows created before owner tracking — only show them if they
      // are explicitly shared (Shared = TRUE).
      const isVisible = (r, idCol) => {
        const shared = r.get('Shared') === 'TRUE' || r.get('Shared') === true;
        const owner  = r.get('Owner') || '';
        return shared || owner === user;
      };

      const birthdays = bdayRows
        .filter(r => isVisible(r))
        .map(r => ({
          id:     r.get('Birthday ID'),
          name:   r.get('Name') || '',
          date:   r.get('Date') || '',
          owner:  r.get('Owner') || '',
          shared: r.get('Shared') === 'TRUE' || r.get('Shared') === true,
          notes:  r.get('Notes') || '',
        }));

      const specialDays = specRows
        .filter(r => isVisible(r))
        .map(r => ({
          id:        r.get('Day ID'),
          name:      r.get('Name') || '',
          date:      r.get('Date') || '',
          recurring: r.get('Recurring') === 'TRUE' || r.get('Recurring') === true,
          owner:     r.get('Owner') || '',
          shared:    r.get('Shared') === 'TRUE' || r.get('Shared') === true,
          notes:     r.get('Notes') || '',
        }));

      return res.status(200).json({ birthdays, specialDays });
    }

    // ── POST: create a birthday or special day ───────────────────────────────
    if (method === 'POST') {
      const { resource } = req.body;

      if (resource === 'birthday') {
        const { name, date, owner, shared, notes } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const bdaySheet = await getOrCreateSheet(doc, 'Birthdays', BIRTHDAY_HEADERS);
        await ensureHeaders(bdaySheet, BIRTHDAY_HEADERS);
        const rows  = await bdaySheet.getRows();
        const newId = Math.max(...rows.map(r => parseInt(r.get('Birthday ID')) || 0), 0) + 1;

        await bdaySheet.addRow({
          'Birthday ID': newId,
          Name:   name,
          Date:   date,
          Owner:  owner || '',
          Shared: shared ? 'TRUE' : 'FALSE',
          Notes:  notes || '',
        });
        return res.status(201).json({ id: newId, name, date, owner: owner || '', shared: !!shared, notes: notes || '' });
      }

      if (resource === 'special-day') {
        const { name, date, recurring, owner, shared, notes } = req.body;
        if (!name) return res.status(400).json({ error: 'Name is required' });
        if (!date) return res.status(400).json({ error: 'Date is required' });

        const specSheet = await getOrCreateSheet(doc, 'Special Days', SPECIAL_DAY_HEADERS);
        await ensureHeaders(specSheet, SPECIAL_DAY_HEADERS);
        const rows  = await specSheet.getRows();
        const newId = Math.max(...rows.map(r => parseInt(r.get('Day ID')) || 0), 0) + 1;

        await specSheet.addRow({
          'Day ID':   newId,
          Name:       name,
          Date:       date,
          Recurring:  recurring ? 'TRUE' : 'FALSE',
          Owner:      owner || '',
          Shared:     shared ? 'TRUE' : 'FALSE',
          Notes:      notes || '',
        });
        return res.status(201).json({ id: newId, name, date, recurring: !!recurring, owner: owner || '', shared: !!shared, notes: notes || '' });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    // ── PUT: edit a birthday or special day ─────────────────────────────────
    if (method === 'PUT') {
      const { resource, id } = req.body;

      if (resource === 'birthday') {
        const { name, date, shared, notes } = req.body;
        const bdaySheet = await getOrCreateSheet(doc, 'Birthdays', BIRTHDAY_HEADERS);
        await ensureHeaders(bdaySheet, BIRTHDAY_HEADERS);
        const rows = await bdaySheet.getRows();
        const row  = rows.find(r => r.get('Birthday ID') == id);
        if (!row) return res.status(404).json({ error: 'Birthday not found' });
        if (name  !== undefined) row.set('Name',   name);
        if (date  !== undefined) row.set('Date',   date);
        if (notes !== undefined) row.set('Notes',  notes || '');
        if (shared !== undefined) row.set('Shared', shared ? 'TRUE' : 'FALSE');
        await row.save();
        return res.status(200).json({ id });
      }

      if (resource === 'special-day') {
        const { name, date, recurring, shared, notes } = req.body;
        const specSheet = await getOrCreateSheet(doc, 'Special Days', SPECIAL_DAY_HEADERS);
        await ensureHeaders(specSheet, SPECIAL_DAY_HEADERS);
        const rows = await specSheet.getRows();
        const row  = rows.find(r => r.get('Day ID') == id);
        if (!row) return res.status(404).json({ error: 'Special day not found' });
        if (name      !== undefined) row.set('Name',      name);
        if (date      !== undefined) row.set('Date',      date);
        if (recurring !== undefined) row.set('Recurring', recurring ? 'TRUE' : 'FALSE');
        if (shared    !== undefined) row.set('Shared',    shared ? 'TRUE' : 'FALSE');
        if (notes     !== undefined) row.set('Notes',     notes || '');
        await row.save();
        return res.status(200).json({ id });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    // ── DELETE: remove a birthday or special day ─────────────────────────────
    if (method === 'DELETE') {
      const { resource, id } = req.body;

      if (resource === 'birthday') {
        const bdaySheet = await getOrCreateSheet(doc, 'Birthdays', BIRTHDAY_HEADERS);
        await ensureHeaders(bdaySheet, BIRTHDAY_HEADERS);
        const rows = await bdaySheet.getRows();
        const row  = rows.find(r => r.get('Birthday ID') == id);
        if (!row) return res.status(404).json({ error: 'Birthday not found' });
        await row.delete();
        return res.status(200).json({ id });
      }

      if (resource === 'special-day') {
        const specSheet = await getOrCreateSheet(doc, 'Special Days', SPECIAL_DAY_HEADERS);
        await ensureHeaders(specSheet, SPECIAL_DAY_HEADERS);
        const rows = await specSheet.getRows();
        const row  = rows.find(r => r.get('Day ID') == id);
        if (!row) return res.status(404).json({ error: 'Special day not found' });
        await row.delete();
        return res.status(200).json({ id });
      }

      return res.status(400).json({ error: 'Unknown resource' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Specials API error:', error);
    return res.status(500).json({ error: 'Server error: ' + error.message });
  }
};
