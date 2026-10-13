/** 明示された問題・選択肢・正解だけを読み取る。正解の推測や通信は行わない。 */
const QuestionImport = (() => {
  'use strict';
  const MAX_QUESTIONS = 1000;
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const normalizeLabel = (value) => value.replace(/[０-９Ａ-Ｚａ-ｚ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).toUpperCase();
  const unbold = (value) => {
    const match = value.match(/^(\*\*|__)([\s\S]*)\1$/);
    return match ? match[2].trim() : value;
  };
  const content = (lines) => lines.join('\n').trim();
  const fail = (line, message) => { throw new Error(`${line}行目：${message}`); };

  function syntax(raw) {
    let text = raw.trim();
    const heading = text.match(/^(#{1,6})\s+(.+?)(?:\s+#+)?$/);
    if (heading) text = heading[2];
    text = unbold(text);
    // ラベルだけに付いたMarkdownの強調を除く。問題本文は変換しない。
    text = text.replace(/^(\*\*|__)((?:問(?:題)?\s*[０-９0-9]+|Q\s*[０-９0-9]+|科目|問題形式|模範解答|正解|正答|答え|解答|解説|出典箇所|出典|重要度|ID|形式)(?:[:：.．、)）])?)\1\s*/i, '$2');
    text = text.replace(/^(\*\*|__)((?:[A-Za-zＡ-Ｚａ-ｚ]|[0-9０-９]+)\s*[.．:：)）])\1\s*/, '$2');
    return { text, heading: heading ? heading[1].length : 0 };
  }

  function parse(text, { filename = '', subject = '' } = {}) {
    if (typeof text !== 'string') throw new Error('問題集のテキストを選択または貼り付けてください。');
    if (new TextEncoder().encode(text).length > QuestionPacks.MAX_BYTES) throw new Error('問題集は2 MiB以下に分けてください。');
    const body = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    const file = String(filename || '').split(/[\\/]/).pop();
    // JSONは既存の厳密な読み取りに渡し、壊れたJSONを文章として解釈しない。
    if (/\.json$/i.test(file) || /^[{\[]/.test(body) || /^```(?:json)?[ \t]*\n/i.test(body)) {
      return { pack: QuestionPacks.parse(text), warnings: [] };
    }
    if (!body) throw new Error('問題集が空です。');
    let plain = body;
    const textFence = plain.match(/^```(?:text|txt|markdown|md)[ \t]*\n([\s\S]*?)\n```$/i);
    if (textFence) plain = textFence[1];
    if (/^```/.test(plain) || /\n```/.test(plain)) throw new Error('コード枠は問題集全体を1つだけ囲んでください。');

    const fields = { 問題形式: 'questionType', 模範解答: 'modelAnswer', 正解: 'answer', 正答: 'answer', 答え: 'answer', 解答: 'answer', 解説: 'explanation', 出典: 'document', 出典箇所: 'location', 重要度: 'importance', ID: 'id', 形式: 'format' };
    const blocks = [];
    const questionNumbers = new Set();
    let subjectName = '';
    let current = null;
    let active = 'text';

    plain.split('\n').forEach((raw, index) => {
      const line = index + 1;
      const parsed = syntax(raw);
      const value = parsed.text;
      if (!value) {
        if (current && ['text', 'choice', 'explanation', 'modelAnswer'].includes(active)) {
          (active === 'choice' ? current.choices[current.choices.length - 1].lines : current[active]).push('');
        }
        return;
      }
      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(value)) {
        if (current && active === 'modelAnswer') current.modelAnswer.push(raw.trim());
        return;
      }
      const question = value.match(/^(?:問(?:題)?|Q)\s*([0-9０-９]+)(?:\s*[:：.．、)）]\s*|\s+|$)(.*)$/i);
      if (question) {
        const number = Number(normalizeLabel(question[1]));
        if (!Number.isSafeInteger(number) || number < 1) fail(line, '問題番号は1以上の整数にしてください。');
        if (questionNumbers.has(number)) fail(line, `問${number}の番号が重複しています。`);
        if (blocks.length >= MAX_QUESTIONS) fail(line, '問題集は1,000問以下に分けてください。');
        questionNumbers.add(number);
        current = { number, line, text: question[2] ? [question[2]] : [], choices: [], fields: {} };
        blocks.push(current);
        active = 'text';
        return;
      }
      if (/^(?:問(?:題)?|Q)\s*[0-9０-９]/i.test(value)) fail(line, '問題番号の後に「：」か空白を入れてください。');
      const subjectLine = value.match(/^科目\s*[:：]\s*(.*)$/);
      if (subjectLine || (!current && parsed.heading === 1)) {
        if (current) fail(line, '科目名は最初の問題より前に1つだけ書いてください。');
        const next = (subjectLine ? subjectLine[1] : value).trim();
        if (!next) fail(line, '科目名が空です。');
        if (subjectName) fail(line, '科目名が複数あります。問題集を科目ごとに分けてください。');
        subjectName = next;
        return;
      }
      if (!current) fail(line, '「科目：科目名」または「問1：問題文」から始めてください。');
      const meta = value.match(/^(問題形式|模範解答|正解|正答|答え|解答|解説|出典箇所|出典|重要度|ID|形式)\s*[:：]\s*(.*)$/i);
      if (meta) {
        const key = fields[meta[1].toUpperCase()] || fields[meta[1]];
        if (own(current.fields, key)) fail(line, `問${current.number}の「${meta[1]}」が重複しています。`);
        current.fields[key] = line;
        current[key] = meta[2] ? [meta[2]] : [];
        active = key;
        return;
      }
      // 解説・模範解答内の箇条書きを選択肢として拾わない。
      const choice = value.match(/^(?:[-*+]\s+)?([A-Za-zＡ-Ｚａ-ｚ]|[0-9０-９]+)\s*[.．:：)）]\s*(.*)$/);
      if (choice && !['explanation', 'modelAnswer'].includes(active)) {
        if (own(current.fields, 'answer')) fail(line, `問${current.number}の選択肢は正解より前に書いてください。`);
        const label = normalizeLabel(choice[1]);
        const kind = /^[0-9]+$/.test(label) ? 'number' : 'letter';
        const expected = kind === 'number' ? String(current.choices.length + 1) : String.fromCharCode(65 + current.choices.length);
        if (current.choices.length && kind !== current.choices[0].kind) fail(line, `問${current.number}の選択肢は英字か数字に統一してください。`);
        if (label !== expected) fail(line, `問${current.number}の選択肢は${kind === 'number' ? '1' : 'A'}から順番に書いてください。重複や番号の抜けは使えません。`);
        current.choices.push({ label, kind, lines: choice[2] ? [choice[2]] : [], line });
        active = 'choice';
        return;
      }
      if (parsed.heading && active !== 'modelAnswer') fail(line, '見出しには「問1」のような問題番号を書いてください。');
      if (active === 'text') {
        if (/^[^:：\n]{1,20}[:：]/.test(value)) fail(line, '未対応の項目です。問題文は「問1：」と同じ行か、ラベルなしの続きの行に書いてください。');
        current.text.push(raw.trim());
      } else if (active === 'choice') {
        if (!/^[ \t　]+\S/.test(raw)) fail(line, `問${current.number}の選択肢の続きは字下げしてください。「正解：B」のような正解の指定も必要です。`);
        current.choices[current.choices.length - 1].lines.push(raw.trim());
      } else if (['explanation', 'document', 'location', 'modelAnswer'].includes(active)) {
        current[active].push(raw.trim());
      } else if (!current[active].length) {
        current[active].push(raw.trim());
      } else {
        fail(line, '読み取れない行があります。「問2：」「解説：」などのラベルを付けてください。');
      }
    });
    if (!blocks.length) throw new Error('問題が見つかりません。「問1：問題文」の形式で書いてください。');

    const warnings = [];
    if (!subjectName) {
      subjectName = String(subject || '').trim() || file.replace(/\.[^.]+$/, '').trim() || '追加した問題';
      warnings.push(`科目名の指定がないため「${subjectName}」を使いました。`);
    }
    let missingSources = 0;
    let missingLocations = 0;
    const origin = file || '貼り付けた問題集';
    const questions = blocks.map((block) => {
      const text = content(block.text);
      if (!text) fail(block.line, `問${block.number}の問題文が空です。`);
      const specifiedType = own(block.fields, 'questionType') ? content(block.questionType) : '';
      if (own(block.fields, 'questionType') && !QuestionPacks.TYPES.includes(specifiedType)) fail(block.fields.questionType, `問題形式は${QuestionPacks.TYPES.join('・')}のいずれかを指定してください。`);
      const written = specifiedType === '記述';
      if (own(block.fields, 'modelAnswer') && !written) fail(block.fields.modelAnswer, `問${block.number}に「問題形式：記述」を指定してください。`);
      if (written && block.choices.length) fail(block.line, `問${block.number}は記述形式のため選択肢を指定できません。`);
      if (!written && block.choices.length < 2) fail(block.line, `問${block.number}には2つ以上の選択肢が必要です。`);
      const choices = block.choices.map(c => content(c.lines));
      if (choices.some(c => !c)) fail(block.line, `問${block.number}に空の選択肢があります。`);
      let answer;
      if (written) {
        if (own(block.fields, 'answer')) fail(block.fields.answer, `問${block.number}は「正解：」ではなく「模範解答：」を使ってください。`);
        answer = own(block.fields, 'modelAnswer') ? content(block.modelAnswer) : '';
        if (!answer) fail(block.line, `問${block.number}に空でない「模範解答：」を指定してください。`);
      } else {
        const answerText = own(block.fields, 'answer') ? content(block.answer) : '';
        if (!answerText) fail(block.line, `問${block.number}に「正解：B」のような正解の指定がありません。`);
        const candidates = new Set();
        choices.forEach((c, i) => { if (c === answerText) candidates.add(i); });
        const answerLabel = unbold(answerText).match(/^[（(]?\s*([A-Za-zＡ-Ｚａ-ｚ]|[0-9０-９]+)\s*[)）]?[.．]?$/);
        if (answerLabel) {
          const found = block.choices.findIndex(c => c.label === normalizeLabel(answerLabel[1]));
          if (found !== -1) candidates.add(found);
        }
        if (candidates.size !== 1) fail(block.fields.answer, `問${block.number}の正解を1つに特定できません。選択肢の記号か、選択肢と完全に同じ文章を指定してください。`);
        answer = [...candidates][0];
      }
      let document = block.document ? content(block.document) : '';
      let location = block.location ? content(block.location) : '';
      if (own(block.fields, 'document') && !document) fail(block.fields.document, '出典が空です。指定しない場合はラベルごと削除してください。');
      if (own(block.fields, 'location') && !location) fail(block.fields.location, '出典箇所が空です。指定しない場合はラベルごと削除してください。');
      if (!document) {
        missingSources++;
        document = location ? `出典資料未指定（取り込み元：${origin}）` : `${origin}（取り込み元）`;
        if (!location) location = `問${block.number}`;
      } else if (!location) {
        missingLocations++;
        location = `出典箇所未指定（問題集の問${block.number}）`;
      }
      const question = {
        id: block.id ? content(block.id) : '', subject: subjectName,
        source: { document, location },
        format: own(block.fields, 'format') ? content(block.format) : 'その他',
        questionType: specifiedType || (choices.length === 2 && choices[0] === '正しい' && choices[1] === '誤り' ? '正誤' : '選択肢'),
        text, choices, answer,
      };
      if (own(block.fields, 'explanation')) question.explanation = content(block.explanation);
      if (own(block.fields, 'importance')) question.importance = normalizeLabel(content(block.importance));
      if (own(block.fields, 'id') && !question.id) fail(block.fields.id, 'IDが空です。指定しない場合はラベルごと削除してください。');
      if (!question.id) question.id = `imported-${QuestionPacks.fingerprint(question)}`;
      return question;
    });
    if (missingSources) warnings.push(`${missingSources}問は講義資料の出典が未指定です。取り込み元を記録しました。`);
    if (missingLocations) warnings.push(`${missingLocations}問は出典箇所が未指定です。`);
    const pack = { schemaVersion: QuestionPacks.SCHEMA_VERSION, subject: subjectName, questions };
    const checked = QuestionPacks.validate(pack);
    if (!checked.ok) throw new Error(checked.errors.slice(0, 3).map(e => `${e.path}：${e.reason}`).join('\n'));
    return { pack: checked.pack, warnings };
  }
  return { parse };
})();
