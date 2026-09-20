'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeImposition } = require('../src/imposition');

/** 收集拼版结果中的全部页位（每张纸正反 × 左右）。 */
function allSlots(r) {
  const slots = [];
  r.signatures.forEach((sig) => {
    sig.sheets.forEach((sheet) => {
      slots.push(sheet.front.left, sheet.front.right, sheet.back.left, sheet.back.right);
    });
  });
  return slots;
}

/** 收集全部非空白页码。 */
function allPages(r) {
  return allSlots(r).filter((s) => !s.blank).map((s) => s.page);
}

test('均衡分帖：10 页 2 张/帖 -> [2,1] 分配，空白页集中在末帖末尾', () => {
  const r = computeImposition({ totalPages: 10, sheetsPerSignature: 2, binding: 'left', flip: 'short', balanced: true });
  assert.equal(r.balance.enabled, true);
  assert.equal(r.input.balanced, true);
  // 整本所需 3 张纸，最少 2 帖：2 + 1
  assert.equal(r.signatureCount, 2);
  assert.deepEqual(r.signatures.map((s) => s.actualSheetCount), [2, 1]);
  assert.equal(r.balance.totalSheets, 3);
  assert.equal(r.paddedPages, 12);
  assert.equal(r.blankPages, 2);
  // 固定分帖为 2 帖 × 8 页 = 16 页（6 个空白页），均衡节省 4 页
  assert.equal(r.balance.fixedBlankPages, 6);
  assert.equal(r.balance.savedBlankPages, 4);
  // 每帖按自身页数连续编号
  assert.deepEqual([r.signatures[0].pageStart, r.signatures[0].pageEnd], [1, 8]);
  assert.deepEqual([r.signatures[1].pageStart, r.signatures[1].pageEnd], [9, 12]);
  assert.equal(r.signatures[0].pageCount, 8);
  assert.equal(r.signatures[1].pageCount, 4);
  // 空白页只出现在末帖末尾（页码 11、12）
  const sig1Blanks = allSlots({ signatures: [r.signatures[0]] }).filter((s) => s.blank);
  assert.equal(sig1Blanks.length, 0);
  const sig2 = r.signatures[1];
  const sheet = sig2.sheets[0];
  assert.equal(sheet.front.left.blank, true); // 页 12
  assert.equal(sheet.front.right.page, 9);
  assert.equal(sheet.back.left.page, 10);
  assert.equal(sheet.back.right.blank, true); // 页 11
});

test('均衡分帖：各帖实际张数差不超过 1，且不超过每帖张数上限', () => {
  // 28 页 3 张/帖：需 7 张纸，最少 3 帖 -> [3,2,2]
  const r = computeImposition({ totalPages: 28, sheetsPerSignature: 3, binding: 'left', flip: 'short', balanced: true });
  assert.deepEqual(r.signatures.map((s) => s.actualSheetCount), [3, 2, 2]);
  const counts = r.signatures.map((s) => s.actualSheetCount);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
  counts.forEach((n) => assert.ok(n <= 3));
  // 每帖连续编号：1-12 / 13-20 / 21-28
  assert.deepEqual([r.signatures[0].pageStart, r.signatures[0].pageEnd], [1, 12]);
  assert.deepEqual([r.signatures[1].pageStart, r.signatures[1].pageEnd], [13, 20]);
  assert.deepEqual([r.signatures[2].pageStart, r.signatures[2].pageEnd], [21, 28]);
  // 无空白页，相对固定分帖（3 帖 × 12 页 = 36 页）节省 8 页
  assert.equal(r.blankPages, 0);
  assert.equal(r.balance.fixedBlankPages, 8);
  assert.equal(r.balance.savedBlankPages, 8);
});

test('均衡分帖：多组参数下页码完整（1..totalPages 各出现一次）且空白页仅在末帖', () => {
  const cases = [
    { totalPages: 1, sheetsPerSignature: 1 },
    { totalPages: 5, sheetsPerSignature: 2 },
    { totalPages: 9, sheetsPerSignature: 2 },
    { totalPages: 13, sheetsPerSignature: 3 },
    { totalPages: 17, sheetsPerSignature: 2 },
    { totalPages: 33, sheetsPerSignature: 4 },
    { totalPages: 100, sheetsPerSignature: 7 },
  ];
  cases.forEach(({ totalPages, sheetsPerSignature }) => {
    const r = computeImposition({ totalPages, sheetsPerSignature, binding: 'left', flip: 'short', balanced: true });
    // 页码 1..totalPages 各出现一次
    assert.deepEqual(
      allPages(r).sort((a, b) => a - b),
      Array.from({ length: totalPages }, (_, i) => i + 1)
    );
    // 空白页数量 = 总纸张 × 4 - 成品页数，且全部位于末帖
    assert.equal(r.blankPages, r.balance.totalSheets * 4 - totalPages);
    r.signatures.slice(0, -1).forEach((sig) => {
      sig.sheets.forEach((sheet) => {
        [sheet.front.left, sheet.front.right, sheet.back.left, sheet.back.right].forEach((s) => {
          assert.equal(s.blank, false);
        });
      });
    });
    // 各帖张数差 ≤ 1 且 ≤ 上限
    const counts = r.signatures.map((s) => s.actualSheetCount);
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
    counts.forEach((n) => assert.ok(n >= 1 && n <= sheetsPerSignature));
    // 帖间页码连续相接
    r.signatures.forEach((sig, i) => {
      if (i > 0) assert.equal(sig.pageStart, r.signatures[i - 1].pageEnd + 1);
      assert.equal(sig.pageEnd - sig.pageStart + 1, sig.actualSheetCount * 4);
    });
  });
});

test('均衡分帖：帖内正反页位规则与固定分帖一致（按该帖页码范围配对）', () => {
  const r = computeImposition({ totalPages: 28, sheetsPerSignature: 3, binding: 'left', flip: 'short', balanced: true });
  // 第 2 帖（页 13-20，2 张）：与同等范围的固定拼版布局相同
  const [s1, s2] = r.signatures[1].sheets;
  assert.deepEqual([s1.front.left.page, s1.front.right.page], [20, 13]);
  assert.deepEqual([s1.back.left.page, s1.back.right.page], [14, 19]);
  assert.deepEqual([s2.front.left.page, s2.front.right.page], [18, 15]);
  assert.deepEqual([s2.back.left.page, s2.back.right.page], [16, 17]);
  // 长边翻转 / 右装订同样按帖自身页数计算（第 2 帖页 9-12，1 张；页 11、12 为空白）
  const r2 = computeImposition({ totalPages: 10, sheetsPerSignature: 2, binding: 'right', flip: 'long', balanced: true });
  const sheet = r2.signatures[1].sheets[0];
  assert.deepEqual([sheet.front.left.page, sheet.front.right.page], [9, null]);
  assert.deepEqual([sheet.back.left.page, sheet.back.right.page], [10, null]);
});

test('均衡分帖：爬移补偿按各帖实际层数重算', () => {
  const r = computeImposition({
    totalPages: 28, sheetsPerSignature: 3, binding: 'left', flip: 'short',
    balanced: true, paperThickness: 0.1, maxCompensation: 5,
  });
  // 顶层仍给出按上限（3 张）的完整序列
  assert.deepEqual(r.creep.sheetCompensationMm, [0, 0.2, 0.4]);
  // 各帖按实际层数：3 张帖 [0,0.2,0.4]，2 张帖 [0,0.2]
  assert.deepEqual(r.signatures[0].sheetCompensationMm, [0, 0.2, 0.4]);
  assert.deepEqual(r.signatures[1].sheetCompensationMm, [0, 0.2]);
  assert.deepEqual(r.signatures[2].sheetCompensationMm, [0, 0.2]);
  // 末帖（2 张）第 2 张补偿 0.2，不存在第 3 张的 0.4
  const sig3 = r.signatures[2];
  assert.equal(sig3.sheets.length, 2);
  assert.equal(sig3.sheets[0].front.left.offsetMm, 0);
  assert.equal(sig3.sheets[1].front.left.offsetMm, 0.2);
  assert.equal(sig3.sheets[1].front.right.offsetMm, -0.2);
  // 每帖独立从 i=0 起算
  r.signatures.forEach((sig) => {
    assert.equal(sig.sheets[0].front.left.offsetMm, 0);
  });
});

test('均衡分帖：适配检查按实际页位统计', () => {
  const r = computeImposition({
    totalPages: 10, sheetsPerSignature: 2, binding: 'left', flip: 'short', balanced: true,
    paperWidth: 440, paperHeight: 310, pageWidth: 210, pageHeight: 297,
  });
  assert.equal(r.fit.enabled, true);
  // 3 张纸 × 4 页位 = 12 个页位（固定分帖为 16 个）
  assert.equal(r.fit.totalSlots, 12);
  assert.equal(r.fit.ok, true);
});

test('均衡分帖关闭（缺省 / false）：保持固定分帖结果', () => {
  const input = { totalPages: 10, sheetsPerSignature: 2, binding: 'left', flip: 'short' };
  const def = computeImposition(input);
  const off = computeImposition({ ...input, balanced: false });
  [def, off].forEach((r) => {
    assert.equal(r.balance.enabled, false);
    assert.equal(r.input.balanced, false);
    assert.equal(r.balance.savedBlankPages, 0);
    assert.equal(r.balance.fixedBlankPages, r.blankPages);
    assert.deepEqual(r.signatures.map((s) => s.actualSheetCount), [2, 2]);
    assert.equal(r.paddedPages, 16);
    assert.equal(r.blankPages, 6);
    // 固定分帖下每帖 actualSheetCount 等于每帖张数，帖序列与顶层爬移序列一致
    r.signatures.forEach((sig) => {
      assert.equal(sig.actualSheetCount, 2);
      assert.deepEqual(sig.sheetCompensationMm, r.creep.sheetCompensationMm);
    });
  });
  // 缺省与显式 false 的页码拼版完全一致
  const strip = (r) => JSON.parse(JSON.stringify(r.signatures));
  assert.deepEqual(strip(off), strip(def));
});

test('均衡分帖：非 true 的值不启用（向后兼容）', () => {
  const input = { totalPages: 10, sheetsPerSignature: 2, binding: 'left', flip: 'short' };
  ['true', 1, 'yes'].forEach((v) => {
    const r = computeImposition({ ...input, balanced: v });
    assert.equal(r.balance.enabled, false);
    assert.equal(r.blankPages, 6);
  });
});

test('均衡分帖：页数恰好装满时与固定分帖结果一致', () => {
  const input = { totalPages: 16, sheetsPerSignature: 2, binding: 'left', flip: 'short' };
  const balanced = computeImposition({ ...input, balanced: true });
  const fixed = computeImposition(input);
  assert.equal(balanced.balance.enabled, true);
  assert.equal(balanced.balance.savedBlankPages, 0);
  assert.deepEqual(balanced.signatures.map((s) => s.actualSheetCount), [2, 2]);
  const strip = (r) => JSON.parse(JSON.stringify(r.signatures));
  assert.deepEqual(strip(balanced), strip(fixed));
});
