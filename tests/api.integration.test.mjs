import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import ExcelJS from 'exceljs'
import { createApp } from '../server/index.js'
import { resetDb } from '../server/db.js'

async function registerAndGetSession(app, email, workspaceName) {
  const response = await request(app)
    .post('/api/auth/register')
    .send({
      name: email.split('@')[0],
      email,
      password: 'password123',
      workspaceName,
    })

  expect(response.status).toBe(201)
  return {
    token: response.body.token,
    workspaceId: response.body.workspaces[0].id,
  }
}

describe('API integration', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('enforces workspace isolation for drafting', async () => {
    const app = createApp()
    const alice = await registerAndGetSession(app, 'alice.test@example.com', 'Alice Workspace')
    const bob = await registerAndGetSession(app, 'bob.test@example.com', 'Bob Workspace')

    const knowledge = Buffer.from(
      'Security policy with ISO controls, quarterly audits, access governance, and incident response procedures for public-sector bids.',
      'utf8',
    )

    const idx = await request(app)
      .post('/api/knowledge/index')
      .set('Authorization', `Bearer ${alice.token}`)
      .field('workspaceId', alice.workspaceId)
      .field('sourcePath', 'kb/security.txt')
      .attach('files', knowledge, { filename: 'security.txt', contentType: 'text/plain' })

    expect(idx.status).toBe(200)
    expect(idx.body.indexed).toBe(1)

    const blocked = await request(app)
      .post('/api/tender/draft')
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ workspaceId: alice.workspaceId, questions: ['Describe your security policy'] })

    expect(blocked.status).toBe(403)
    expect(blocked.body.error).toContain('do not have access')
  })

  it('versions by sourcePath and supports xlsx parse + export', async () => {
    const app = createApp()
    const user = await registerAndGetSession(app, 'version.test@example.com', 'Version Workspace')

    const first = await request(app)
      .post('/api/knowledge/index')
      .set('Authorization', `Bearer ${user.token}`)
      .field('workspaceId', user.workspaceId)
      .field('sourcePath', 'folder-a/profile.txt')
      .attach(
        'files',
        Buffer.from(
          'Company profile and experience details with project delivery timelines, references, and bid compliance history over multiple years.',
          'utf8',
        ),
        {
        filename: 'profile.txt',
        contentType: 'text/plain',
        },
      )

    const second = await request(app)
      .post('/api/knowledge/index')
      .set('Authorization', `Bearer ${user.token}`)
      .field('workspaceId', user.workspaceId)
      .field('sourcePath', 'folder-a/profile.txt')
      .attach(
        'files',
        Buffer.from(
          'Company profile updated content including revised team composition, support model, and delivery governance structure for enterprise tenders.',
          'utf8',
        ),
        {
        filename: 'profile.txt',
        contentType: 'text/plain',
        },
      )

    const third = await request(app)
      .post('/api/knowledge/index')
      .set('Authorization', `Bearer ${user.token}`)
      .field('workspaceId', user.workspaceId)
      .field('sourcePath', 'folder-b/profile.txt')
      .attach(
        'files',
        Buffer.from(
          'Different folder same file name but separate business unit context, pricing assumptions, and references for another domain.',
          'utf8',
        ),
        {
        filename: 'profile.txt',
        contentType: 'text/plain',
        },
      )

    expect(first.body.files[0].version).toBe(1)
    expect(second.body.files[0].version).toBe(2)
    expect(third.body.files[0].version).toBe(1)

    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('RFP')
    sheet.addRow(['Question'])
    sheet.addRow(['Describe your security policy and controls?'])
    const xlsxBuffer = Buffer.from(await workbook.xlsx.writeBuffer())

    const parse = await request(app)
      .post('/api/tender/parse')
      .set('Authorization', `Bearer ${user.token}`)
      .field('workspaceId', user.workspaceId)
      .attach('file', xlsxBuffer, {
        filename: 'tender.xlsx',
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(parse.status).toBe(200)
    expect(parse.body.questions.length).toBeGreaterThan(0)

    const draft = await request(app)
      .post('/api/tender/draft')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ workspaceId: user.workspaceId, questions: parse.body.questions })

    expect(draft.status).toBe(200)
    expect(draft.body.draft.length).toBeGreaterThan(0)

    const exportXlsx = await request(app)
      .post('/api/tender/export')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ workspaceId: user.workspaceId, format: 'xlsx', draft: draft.body.draft })

    expect(exportXlsx.status).toBe(200)
    expect(exportXlsx.headers['content-type']).toContain('spreadsheetml.sheet')
  })
})
