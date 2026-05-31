const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

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
      // Get all notes visible to the current user
      const user = event.queryStringParameters?.user;
      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      const rows = await sheet.getRows();

      // Filter: show if shared OR user is the owner
      const visibleRows = rows.filter(row => {
        const isShared = row.get('Shared') === 'TRUE' || row.get('Shared') === true;
        const isOwner = row.get('Owner') === user;
        return isShared || isOwner;
      });

      const notes = visibleRows.map(row => ({
        id: row.get('Note ID'),
        content: row.get('Note'),
        dateCreated: row.get('Date Created'),
        owner: row.get('Owner') || '',
        shared: row.get('Shared') === 'TRUE' || row.get('Shared') === true,
        project: row.get('Project') || '',
      }));

      return {
        statusCode: 200,
        body: JSON.stringify(notes),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'POST') {
      // Add a new note
      const { content, owner, shared, project } = JSON.parse(event.body);

      if (!content) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Note content is required' }),
        };
      }

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      const rows = await sheet.getRows();

      const maxId = Math.max(...rows.map(r => parseInt(r.get('Note ID')) || 0), 0);
      const newId = maxId + 1;

      // Create ISO date string
      const now = new Date().toISOString();

      await sheet.addRow({
        'Note ID': newId,
        'Note': content,
        'Date Created': now,
        'Owner': owner || '',
        'Shared': shared ? 'TRUE' : 'FALSE',
        'Project': project || '',
      });

      return {
        statusCode: 201,
        body: JSON.stringify({ id: newId, content, dateCreated: now, owner, shared, project: project || '' }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'PUT') {
      // Update a note (content and/or shared)
      const { id, content, shared, project } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Note ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Note not found' }),
        };
      }

      if (content !== undefined) row.set('Note', content);
      if (shared !== undefined) row.set('Shared', shared ? 'TRUE' : 'FALSE');
      if (project !== undefined) row.set('Project', project || '');
      await row.save();

      return {
        statusCode: 200,
        body: JSON.stringify({
          id,
          content: row.get('Note'),
          dateCreated: row.get('Date Created'),
          owner: row.get('Owner') || '',
          shared: row.get('Shared') === 'TRUE',
          project: row.get('Project') || '',
        }),
        headers: { 'Content-Type': 'application/json' },
      };
    }

    if (method === 'DELETE') {
      // Delete a note
      const { id } = JSON.parse(event.body);

      const doc = await initializeSheet();
      const sheet = doc.sheetsByTitle['Notes'];
      const rows = await sheet.getRows();

      const row = rows.find(r => r.get('Note ID') == id);

      if (!row) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Note not found' }),
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
