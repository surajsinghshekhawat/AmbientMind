const { app } = require('electron')
const path = require('node:path')
app.setName('ambientmind')
app.setPath('userData', path.join(app.getPath('appData'), 'ambientmind'))

app.whenReady().then(() => {
  try {
    const Database = require('better-sqlite3')
    const db = new Database(path.join(app.getPath('userData'), 'ambientmind.db'))
    const rows = db
      .prepare(
        `SELECT title, status, priority, deadline, created_at FROM tasks WHERE status = 'pending' ORDER BY created_at DESC`
      )
      .all()
    console.log('PENDING', rows.length)
    for (const r of rows) {
      console.log(
        JSON.stringify({
          title: r.title,
          priority: r.priority,
          deadline: r.deadline,
          created: r.created_at
        })
      )
    }
    db.close()
    process.exit(0)
  } catch (e) {
    console.error(e)
    process.exit(1)
  }
})
