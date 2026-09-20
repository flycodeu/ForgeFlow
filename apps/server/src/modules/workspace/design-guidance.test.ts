import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFeatureDesignGuidance } from './design-guidance.js';

const base = {
  projectName: '示例项目',
  projectDescription: '',
  featureName: '示例能力',
  featureSummary: '',
  documents: [
    { kind: 'requirements', revisionNo: 2, content: '# 需求\n必须可以直接指导实现。' },
    { kind: 'research', revisionNo: 3, content: '# 调研\n记录外部事实和适用边界。' },
    { kind: 'architecture', revisionNo: 5, content: '# 架构\n描述真实运行组件。' },
  ],
};

test('adaptive design guidance keeps one process while selecting project-specific sections and tasks', () => {
  const web = buildFeatureDesignGuidance({ ...base, projectType: 'WEB', featureName: '用户管理' });
  assert.equal(web.profile, 'WEB');
  assert.ok(web.adaptiveSections.includes('接口与契约'));
  assert.ok(web.adaptiveSections.includes('页面与交互'));
  assert.match(web.markdownTemplate, /## CAP-01 核心能力/);
  assert.match(web.markdownTemplate, /Requirement REV 2/);
  assert.match(web.markdownTemplate, /Research REV 3/);
  assert.match(web.markdownTemplate, /Architecture REV 5/);
  assert.match(web.markdownTemplate, /Artifact Type \| Artifact \| Impact \| Reason/);
  assert.match(web.markdownTemplate, /# 8\. 数据、状态与兼容性/);
  assert.match(web.markdownTemplate, /# 12\. 验收用例与证据/);
  assert.match(web.markdownTemplate, /# 13\. 可观测性、安全与发布/);

  const godot = buildFeatureDesignGuidance({ ...base, projectType: 'Godot 4', featureName: '2D 背包系统',
    documents: [{ kind: 'technology', revisionNo: 1, content: '# Game Engine\nGodot 4\n# Save Data\nJSON' }] });
  assert.equal(godot.profile, 'GODOT');
  assert.ok(godot.adaptiveSections.includes('Scene 结构'));
  assert.ok(godot.adaptiveSections.includes('Signal'));
  assert.ok(godot.suggestedTasks.some((item) => item.area === 'playtest'));
  assert.doesNotMatch(godot.markdownTemplate, /# API|# 数据库|# Backend|# Frontend/);

  const pipeline = buildFeatureDesignGuidance({ ...base, projectType: 'C++ / 视频流', featureName: 'RTSP 实时推理 Pipeline',
    documents: [{ kind: 'research', revisionNo: 4, content: '# FFmpeg 调研\nRTSP H264 H265 decode reconnect backpressure' }] });
  assert.equal(pipeline.profile, 'PIPELINE');
  assert.ok(pipeline.adaptiveSections.includes('Queue 与 Buffer'));
  assert.ok(pipeline.adaptiveSections.includes('Reconnect'));
  assert.ok(pipeline.suggestedTasks.some((item) => item.area === 'performance'));
  assert.ok(pipeline.suggestedTasks.every((item) => !['frontend', 'backend'].includes(item.area)));
  assert.doesNotMatch(pipeline.markdownTemplate, /# Frontend|# Backend|# 页面与交互|# 数据库/);
});
