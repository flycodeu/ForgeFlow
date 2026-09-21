import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createHash } from 'node:crypto';
import type { ArchiveDocumentDetail, CreatedAiToken, EngineeringAssetRevision, Project, ProjectArchiveExport, WorkEventPage, WorkEventReceipt } from '@forgeflow/contracts';
import { createApp } from '../../app.js';
import { openDatabase } from '../../db/client.js';
import type { ProjectArchivePreview, ProjectDetail } from '@forgeflow/contracts';

test('project archive preserves source text, revisions, idempotent events and project isolation across restart', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-archive-'));
  const path = join(directory, 'archive.db');
  let app = createApp(path);
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async <T>(method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object, token?: string) => {
    const response = await app.inject({ method, url, payload, headers: token ? { authorization: `Bearer ${token}` } : undefined });
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${method} ${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  const project = await request<Project>('POST', '/api/projects', { projectKey: 'ARCHIVE', name: '档案', workflowMode: 'CONTROLLED' });
  const other = await request<Project>('POST', '/api/projects', { projectKey: 'OTHER', name: '另一项目' });
  const base = `/api/projects/${project.id}/archive`;
  const otherBase = `/api/projects/${other.id}/archive`;
  const original = { title: '自由设计', content: '\n# 自由设计\r\n\n不要求模板。  \n',
    originalFilename: '设计.md', sourcePath: 'D:\\workspace\\设计.md', contentType: 'text/markdown' };
  const document = await request<ArchiveDocumentDetail>('POST', `${base}/documents`, original);
  assert.equal(document.content, original.content);
  const duplicate = await request<ArchiveDocumentDetail>('POST', `${base}/documents`, original);
  assert.equal(duplicate.id, document.id);
  const changedImport = await app.inject({ method: 'POST', url: `${base}/documents`, payload: { ...original, content: 'changed' } });
  assert.equal(changedImport.statusCode, 409);
  assert.equal(changedImport.json().error.documentId, document.id);
  const current = await request<ArchiveDocumentDetail>('PATCH', `${base}/documents/${document.id}`,
    { ...original, title: '自由设计二', content: '第二次原文\n', expectedRevisionId: document.currentRevisionId, changeSummary: '补充内容' });
  assert.equal((await app.inject({ method: 'PATCH', url: `${base}/documents/${document.id}`, payload: {
    ...original, expectedRevisionId: document.currentRevisionId,
  } })).statusCode, 409);
  const history = await request<EngineeringAssetRevision[]>('GET', `${base}/documents/${document.id}/revisions`);
  assert.equal(history.length, 2);
  assert.equal(history.find((row) => row.id === document.currentRevisionId)?.contentMarkdown, original.content);
  assert.equal(history.find((row) => row.id === current.currentRevisionId)?.contentMarkdown, '第二次原文\n');
  assert.equal((await app.inject({ method: 'GET', url: `${otherBase}/documents/${document.id}` })).statusCode, 404);
  assert.equal((await app.inject({ method: 'GET', url: `${otherBase}/documents/${document.id}/revisions` })).statusCode, 404);
  const first = { operationId: 'plan-1', title: '调查现状', type: 'PLAN', content: '无需任务和审批即可记录。', documentRevisionIds: [document.currentRevisionId] };
  const receipt = await request<WorkEventReceipt>('POST', `${base}/events`, first);
  assert.equal(receipt.committed, true);
  assert.equal(receipt.event.workId, receipt.event.id);
  assert.equal(receipt.event.source.kind, 'local_web');
  assert.equal((await request<WorkEventReceipt>('POST', `${base}/events`, first)).event.id, receipt.event.id);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...first, content: '不同内容' } })).statusCode, 409);
  const result = await request<WorkEventReceipt>('POST', `${base}/events`, { operationId: 'result', workId: receipt.event.workId,
    type: 'RESULT', title: 'AI自报完成', content: '仅记录，未执行额外验证。' });
  const late = await request<WorkEventReceipt>('POST', `${base}/events`, { operationId: 'late', workId: receipt.event.workId,
    type: 'PROGRESS', title: '补记早前进展', content: '', occurredAt: '2025-01-01T00:00:00Z' });
  assert.ok(late.event.sequence > result.event.sequence);
  const page = await request<WorkEventPage>('GET', `${base}/events?limit=2`);
  assert.equal(page.items.length, 2);
  assert.equal(page.nextCursor, result.event.sequence);
  assert.equal((await request<WorkEventPage>('GET', `${base}/events?before=${page.nextCursor}&limit=2`)).items[0]?.id, receipt.event.id);
  assert.equal((await app.inject({ method: 'GET', url: `${base}/events?limit=invalid` })).statusCode, 400);
  assert.equal((await app.inject({ method: 'POST', url: `${otherBase}/events`, payload: { ...first, workId: receipt.event.workId } })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${otherBase}/events`, payload: first })).statusCode, 404);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...first, operationId: 'spoof', source: { kind: 'owner' } } })).statusCode, 400);
  const sourceBeforeRestart = receipt.event.source;
  await app.close();
  app = createApp(path);
  const retried = await request<WorkEventReceipt>('POST', `${base}/events`, first);
  assert.equal(retried.replayed, true);
  assert.equal(retried.event.id, receipt.event.id);
  assert.deepEqual(retried.event.source, sourceBeforeRestart);
  assert.equal((await request<ArchiveDocumentDetail>('GET', `${base}/documents/${document.id}`)).content, current.content);
  const snapshot = await request<ProjectArchiveExport>('GET', `${base}/export`);
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(snapshot.project.project.workflowMode, 'CONTROLLED');
  assert.equal(snapshot.project.tasks.length, 0);
  assert.equal(snapshot.project.runs.length, 0);
  assert.equal(snapshot.documents[0]?.revisions.length, 2);
  assert.equal(snapshot.events.length, 3);
  const deletion = await app.inject({ method: 'DELETE', url: `/api/projects/${project.id}` });
  assert.equal(deletion.statusCode, 409);
  assert.equal(deletion.json().error.code, 'PROJECT_HAS_WORK_RECORDS');
  assert.equal((await request<ProjectArchiveExport>('GET', `${base}/export`)).documents.length, snapshot.documents.length);
  assert.ok(!JSON.stringify(snapshot).includes(other.id));
  const connection = openDatabase(path);
  try {
    assert.throws(() => connection.sqlite.prepare('UPDATE rd_work_event SET title = ? WHERE id = ?').run('rewrite', receipt.event.id), /append-only/);
    assert.throws(() => connection.sqlite.prepare('DELETE FROM rd_work_event WHERE id = ?').run(receipt.event.id), /append-only/);
  } finally { connection.sqlite.close(); }
});

test('archive enforces authentication and derives event identity without exporting system credentials', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-archive-auth-'));
  const app = createApp(join(directory, 'archive.db'));
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const projectResponse = await app.inject({ method: 'POST', url: '/api/projects', payload: { projectKey: 'AUTHARCHIVE', name: '档案鉴权' } });
  const project = projectResponse.json<Project>();
  const base = `/api/projects/${project.id}/archive`;
  const token = async (name: string, scopes: string[]) => {
    const response = await app.inject({ method: 'POST', url: '/api/ai-tokens', payload: { name, scopes } });
    assert.equal(response.statusCode, 201, response.body);
    return response.json<CreatedAiToken>();
  };
  const reader = await token('只读连接', ['project:read', 'spec:read']);
  const exportReader = await token('档案导出连接', ['project:read', 'spec:read', 'task:read']);
  const writer = await token('设计连接', ['spec:write']);
  const writer2 = await token('另一个设计连接', ['spec:write']);
  const payload = { operationId: 'AI-1', type: 'PLAN', title: '自由规划', content: '没有指定模板。' };
  assert.equal((await app.inject({ method: 'GET', url: `${base}/documents`, remoteAddress: '192.0.2.1' })).statusCode, 401);
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload, headers: { authorization: `Bearer ${reader.token}` } })).statusCode, 403);
  const saved = await app.inject({ method: 'POST', url: `${base}/events`, payload, headers: { authorization: `Bearer ${writer.token}` } });
  assert.equal(saved.statusCode, 201, saved.body);
  const event = saved.json<WorkEventReceipt>().event;
  assert.deepEqual(event.source, { kind: 'ai_token', name: '设计连接' });
  assert.equal((await app.inject({ method: 'POST', url: `${base}/events`, payload: { ...payload, workId: event.workId },
    headers: { authorization: `Bearer ${writer2.token}` } })).statusCode, 403);
  assert.equal((await app.inject({ method: 'GET', url: `${base}/export`, headers: { authorization: `Bearer ${reader.token}` } })).statusCode, 403);
  const exported = await app.inject({ method: 'GET', url: `${base}/export`, headers: { authorization: `Bearer ${exportReader.token}` } });
  assert.equal(exported.statusCode, 200);
  for (const forbidden of [writer.token, reader.token, writer2.token, 'tokenHash', 'passwordHash', 'sessionHash']) assert.ok(!exported.body.includes(forbidden));
  const invalid = await app.inject({ method: 'POST', url: `${base}/documents`, payload: { title: 'binary', content: 'data', contentType: 'application/pdf' } });
  assert.equal(invalid.statusCode, 400);
});

test('archive restore roundtrips documents, design history, relationships and run evidence as a new project', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'forgeflow-restore-'));
  const path = join(directory, 'archive.db');
  const app = createApp(path);
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = async <T>(method: 'GET'|'POST', url: string, payload?: object) => {
    const response = await app.inject({method,url,payload});
    assert.ok(response.statusCode >= 200 && response.statusCode < 300, `${url}: ${response.statusCode} ${response.body}`);
    return response.json<T>();
  };
  const project = await request<Project>('POST','/api/projects',{projectKey:'RESTORE',name:'恢复测试'});
  const doc = await request<ArchiveDocumentDetail>('POST',`/api/projects/${project.id}/archive/documents`,{title:'原文',content:'\uFEFF# 原文\r\n保持空行\n',sourcePath:'Z:\\does-not-exist\\原文.md'});
  await request('POST',`/api/projects/${project.id}/archive/events`,{operationId:'record',type:'NOTE',title:'历史',content:'历史原文',documentRevisionIds:[doc.currentRevisionId]});
  const archive = await request<ProjectArchiveExport>('GET',`/api/projects/${project.id}/archive/export`);
  const p=archive.project;
  const now=project.createdAt;
  const edited={projectId:project.id,createdAt:now,updatedAt:now};
  p.modules.push({id:'module',...edited,code:'M',name:'模块',description:'',sortOrder:0});
  p.features.push({id:'feature',...edited,moduleId:'module',code:'F',name:'功能',summary:'',status:'IMPLEMENTING',sortOrder:0});
  p.capabilities.push({id:'capability',...edited,moduleId:'module',featureId:'feature',code:'C',name:'能力',summary:'',status:'TESTING',sortOrder:0});
  p.specifications.push({id:'spec',projectId:project.id,createdAt:now,featureId:'feature',capabilityId:'capability',kind:'capability-design',title:'设计',latestRevisionId:'rev2',latestRevisionNumber:2,approvedRevisionId:'rev1',approvedRevisionNumber:1});
  archive.specificationRevisions.push(...[1,2].map((n)=>({id:`rev${n}`,specId:'spec',revisionNo:n,content:`设计 ${n}\r\n`,contentHash:createHash('sha256').update(`设计 ${n}\r\n`).digest('hex'),source:'local',changeSummary:'保存',createdAt:now})));
  p.tasks.push({id:'task',...edited,featureId:'feature',capabilityId:'capability',code:'T',name:'任务',type:'OTHER',category:'IMPLEMENTATION',area:'',status:'SUBMITTED',objective:'实现',designRevisionId:'rev1',sortOrder:0});
  p.authorizations.push({id:'auth',projectId:project.id,createdAt:now,featureId:'feature',taskId:'task',status:'CONSUMED',authorizedAt:now,revokedAt:null});
  p.sources.push({id:'source',...edited,alias:'main',displayName:'源码',purpose:'',sourceKind:'DIRECTORY',remoteUrl:null,repoSubdir:null,scope:{include:[],exclude:[]},locations:[{environmentKey:'windows',localRoot:'Z:\\never-read',accessibility:'UNKNOWN',analysisStatus:'NOT_REQUESTED',lastCheckedAt:null}],status:'REGISTERED'});
  p.runs.push({id:'run',...edited,featureId:'feature',taskId:'task',authorizationId:'auth',actorType:'MANUAL',actorName:'测试',status:'SUBMITTED',phase:'SUBMITTING',baseCommit:null,resultCommit:null,summary:'自报完成',changedFiles:[{sourceId:'source',relativePath:'app.ts'}],verificationSummary:{status:'PASS',reportedStatus:'PASS',evidenceStatus:'REPORTED',origin:'AI_REPORTED',summary:'历史证据'},designSnapshot:{specifications:[{specId:'spec',revisionId:'rev1',revisionNo:1}],engineeringAssets:[{assetId:doc.id,revisionId:doc.currentRevisionId,revisionNo:1}]},sourceExecutions:[{sourceId:'source',baseline:{kind:'DIRECTORY',commit:null,dirty:null,manifestHash:null},result:{commit:null,workingTreeSummary:null},read:true,modified:true,changedFiles:[{sourceId:'source',relativePath:'app.ts'}],verification:[]}],designSnapshotStatus:'STALE',designSnapshotWarnings:[],issues:[],startedAt:now,submittedAt:now,finishedAt:now});
  p.reviews.push({id:'review',projectId:project.id,createdAt:now,specId:'spec',revisionId:'rev1',status:'APPROVED',submittedAt:now,decidedAt:now,decisionComment:'原结论'});
  p.traceLinks.push({id:'link',projectId:project.id,createdAt:now,sourceType:'CAPABILITY',sourceId:'capability',targetType:'ENGINEERING_ASSET',targetId:doc.id,relation:'IMPLEMENTS'});
  p.sourceAnalyses.push({id:'analysis',projectId:project.id,displayId:'A1',requestedSourceIds:['source'],targetScope:{featureId:'feature',capabilityId:'capability'},environmentKey:'windows',status:'SYNCED',sourceSnapshots:{note:'原样保留'},checkpoint:null,summary:'分析结果',errors:null,requestedAt:now,startedAt:now,completedAt:now,updatedAt:now,sources:p.sources,recommendedFlow:[],exclusions:[],prompts:{codex:'',claude:''}});
  const preview=await request<ProjectArchivePreview>('POST','/api/project-archives/preview',{archive});
  assert.equal(preview.counts.runs,1);
  assert.equal(preview.counts.specificationRevisions,2);
  const failureConnection=openDatabase(path);
  try {
    failureConnection.sqlite.exec("CREATE TRIGGER test_reject_restored_module BEFORE INSERT ON rd_module WHEN NEW.name = '模块' BEGIN SELECT RAISE(ABORT,'intentional restore failure'); END;");
    const failed=await app.inject({method:'POST',url:'/api/project-archives/restore',payload:{archive,projectKey:'ATOMIC',name:'回滚副本',expectedDigest:preview.digest}});
    assert.equal(failed.statusCode,500);
    assert.equal((failureConnection.sqlite.prepare("SELECT count(*) AS count FROM rd_project WHERE project_key='ATOMIC'").get() as {count:number}).count,0);
    failureConnection.sqlite.exec('DROP TRIGGER test_reject_restored_module');
  } finally {failureConnection.sqlite.close();}
  const restored=await request<ProjectDetail>('POST','/api/project-archives/restore',{archive,projectKey:'RESTORED',name:'恢复副本',expectedDigest:preview.digest});
  assert.notEqual(restored.project.id,project.id);
  assert.notEqual(restored.runs[0]!.id,'run');
  assert.equal(restored.runs[0]!.taskId,restored.tasks[0]!.id);
  assert.equal(restored.runs[0]!.authorizationId,restored.authorizations[0]!.id);
  assert.equal(restored.runs[0]!.designSnapshot.specifications[0]!.specId,restored.specifications[0]!.id);
  assert.equal(restored.sourceAnalyses[0]!.requestedSourceIds[0],restored.sources[0]!.id);
  assert.equal(restored.sourceAnalyses[0]!.targetScope.capabilityId,restored.capabilities[0]!.id);
  assert.equal(restored.traceLinks[0]!.targetId,restored.engineeringAssets[0]!.id);
  const roundtrip=await request<ProjectArchiveExport>('GET',`/api/projects/${restored.project.id}/archive/export`);
  assert.equal(roundtrip.documents[0]!.content,doc.content);
  assert.equal(roundtrip.documents[0]!.sourcePath,doc.sourcePath);
  assert.equal(roundtrip.specificationRevisions.length,2);
  assert.equal(roundtrip.events[0]!.workId,roundtrip.events[0]!.id);
  assert.equal(roundtrip.events[0]!.documentRevisionIds[0],roundtrip.documents[0]!.currentRevisionId);
  await request('POST','/api/project-archives/preview',{archive:roundtrip});
  const collision=await app.inject({method:'POST',url:'/api/project-archives/restore',payload:{archive,projectKey:'RESTORED',name:'collision',expectedDigest:preview.digest}});
  assert.equal(collision.statusCode,409);
  assert.equal((await app.inject({method:'DELETE',url:`/api/projects/${restored.project.id}`})).statusCode,409);
  assert.equal((await request<ProjectArchiveExport>('GET',`/api/projects/${project.id}/archive/export`)).documents[0]!.content,doc.content);
  const connection=openDatabase(path);
  try { assert.throws(()=>connection.sqlite.prepare('DELETE FROM rd_work_event WHERE project_id=?').run(project.id),/append-only/); }
  finally {connection.sqlite.close();}
});

test('archive restore rejects invalid structure, foreign references and AI credentials without partial writes', async (t) => {
  const directory=mkdtempSync(join(tmpdir(),'forgeflow-restore-invalid-'));
  const app=createApp(join(directory,'archive.db'));
  t.after(async()=>{await app.close();rmSync(directory,{recursive:true,force:true});});
  const project=(await app.inject({method:'POST',url:'/api/projects',payload:{projectKey:'VALID',name:'原项目'}})).json<Project>();
  const archive=(await app.inject({method:'GET',url:`/api/projects/${project.id}/archive/export`})).json<ProjectArchiveExport>();
  const invalids:unknown[]=[null,{}, {...archive,formatVersion:2}, {...archive,project:{...archive.project,project:{...project,createdAt:'tomorrow'}}}, {...archive,events:[{id:'e',sequence:1,projectId:project.id,workId:'foreign',type:'NOTE',title:'x',content:'',source:{kind:'local_web',name:'x'},occurredAt:project.createdAt,receivedAt:project.createdAt,documentRevisionIds:[]}]}];
  for(const invalid of invalids){
    assert.equal((await app.inject({method:'POST',url:'/api/project-archives/preview',payload:{archive:invalid}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/api/project-archives/restore',payload:{archive:invalid,projectKey:'NEW',name:'新项目',expectedDigest:'0'.repeat(64)}})).statusCode,400);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/project-archives/restore',payload:{archive,projectKey:'NEW',name:'新项目',expectedDigest:'0'.repeat(64)}})).statusCode,409);
  const token=(await app.inject({method:'POST',url:'/api/ai-tokens',payload:{name:'all',scopes:['project:read','project:write','spec:read','spec:write','task:read','planning:write','run:write']}})).json<CreatedAiToken>();
  for(const [method,url,payload] of [['POST','/api/project-archives/preview',{archive}],['POST','/api/project-archives/restore',{archive}]] as const){
    assert.equal((await app.inject({method,url,payload,headers:{authorization:`Bearer ${token.token}`}})).statusCode,403);
    assert.equal((await app.inject({method,url,payload,remoteAddress:'192.0.2.1'})).statusCode,401);
  }
  assert.equal((await app.inject({method:'POST',url:'/api/project-archives/preview',payload:{archive:{padding:'x'.repeat(33_554_433)}}})).statusCode,413);
  assert.equal((await app.inject({method:'GET',url:'/api/projects'})).json<Project[]>().length,1);
});
