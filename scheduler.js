/**
 * 出題の選定と、正誤による箱番号の更新。
 * 画面や保存方法には依存しない純粋なロジックだけを置く。
 */
const Scheduler = (() => {
  const BOX_MIN = 1;
  const BOX_MAX = 5;
  const DAY_MS = 24 * 60 * 60 * 1000;

  /** 箱ごとの基準間隔(日)。重要度の倍率を掛けて実際の間隔にする。箱1は制限なし。 */
  const BOX_INTERVAL_DAYS = {
    1: 0,
    2: 1,
    3: 3,
    4: 7,
    5: 14,
  };

  const IMPORTANCE_VALUES = ['A', 'B', 'C'];
  const DEFAULT_IMPORTANCE = 'B';

  // --- 出題ロジックの調整用の定数。将来は設定として外部化する(spec「将来の拡張」) ---
  /** 重要度ごとの間隔の倍率。A=重点 / B=標準 / C=後回し */
  const IMPORTANCE_INTERVAL_FACTOR = { A: 0.5, B: 1, C: 2 };
  /** 期限判定の許容誤差(日)。学習時刻の数分〜数時間のずれで、翌日の復習が翌々日にならないようにする。 */
  const DUE_TOLERANCE_DAYS = 3 / 24;
  /** 1セッションのうち新規(未出題)問題が占められる枠の割合。復習を新規が排除しないための上限。 */
  const NEW_QUESTION_SHARE = 1 / 3;

  /** 出題形式。正誤形式は2択のため、箱を上げる条件が他と異なる。 */
  const QUESTION_TYPES = ['選択肢', '正誤', '想起'];
  const QUESTION_TYPE_TRUE_FALSE = '正誤';
  /** 正誤形式で箱を1つ上げるのに必要な正解数。 */
  const TRUE_FALSE_CORRECT_TO_ADVANCE = 2;

  /**
   * 未学習の問題の初期状態。
   * 重要度の初期値は問題データ側で指定できる。未指定・不正な値は標準(B)にする。
   */
  function createProgress(importance) {
    if (importance !== undefined && !IMPORTANCE_VALUES.includes(importance)) {
      // 画面には出さず、問題データの誤りとして開発時に気づけるようにする。
      console.warn(
        `[Scheduler] 未知の重要度 "${importance}" を ${DEFAULT_IMPORTANCE} として扱います。`
      );
    }
    return {
      box: BOX_MIN,
      lastAskedAt: null,
      importance: IMPORTANCE_VALUES.includes(importance)
        ? importance
        : DEFAULT_IMPORTANCE,
      correctCount: 0,
      wrongCount: 0,
      // 箱上昇までの保留正解数。正誤形式で使う。箱を上げた時点と不正解時に0へ戻す。
      pendingCorrect: 0,
    };
  }

  /**
   * 問題の学習状況を返す。未学習なら初期状態を作る。
   * 学習状況が保存されている場合はそちらが優先され、
   * 問題データの importance は初回のみ使われる。
   * @param {{id: string, importance?: string}} question 問題オブジェクト
   */
  function getProgress(all, question) {
    const stored = all[question.id];
    return stored
      ? normalizeProgress(stored, question)
      : createProgress(question.importance);
  }

  /**
   * 保存済みの学習状況を現在の形式に揃える。
   * 旧版では連続正解回数(correctStreak)を持ち、偶数回で箱を上げていた。
   * 正誤形式なら「2で割った余り」が現在の保留正解数に相当する。
   * 選択肢形式は正解ごとに箱が上がるため、保留は常に0になる。
   */
  function normalizeProgress(stored, question) {
    if (stored.pendingCorrect !== undefined) {
      return stored;
    }
    const { correctStreak, ...rest } = stored;
    const legacy = correctStreak || 0;
    const pendingCorrect =
      question.questionType === QUESTION_TYPE_TRUE_FALSE
        ? legacy % TRUE_FALSE_CORRECT_TO_ADVANCE
        : 0;
    return { ...rest, pendingCorrect };
  }

  function toTime(iso) {
    return new Date(iso).getTime();
  }

  /** 箱の基準間隔に重要度の倍率を掛けた、実際の復習間隔(日)。 */
  function intervalDays(progress) {
    const base = BOX_INTERVAL_DAYS[progress.box] || 0;
    const factor = IMPORTANCE_INTERVAL_FACTOR[progress.importance] ?? 1;
    return base * factor;
  }

  /**
   * 期限超過量(日)。正なら期限を過ぎており、負なら期限前。
   * 未出題は Infinity とし、順位付けで最上位になる。
   * 全問題をこの1つの基準で並べるため、期限到来と不足分の補充で別の規則を持たない。
   */
  function overdueDays(progress, now) {
    if (!progress.lastAskedAt) {
      return Infinity;
    }
    const elapsedDays = (now.getTime() - toTime(progress.lastAskedAt)) / DAY_MS;
    return elapsedDays - intervalDays(progress);
  }

  /** 期限到来か。許容誤差ぶん手前から期限到来とみなす。 */
  function isDue(progress, now) {
    return overdueDays(progress, now) >= -DUE_TOLERANCE_DAYS;
  }

  function shuffle(items) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  /**
   * 科目で問題を絞り込む。
   * 未指定・空配列の場合は全科目を対象とする。
   */
  function filterBySubjects(entries, subjects) {
    if (!subjects || subjects.length === 0) {
      return entries;
    }
    const selected = new Set(subjects);
    return entries.filter((entry) => selected.has(entry.question.subject));
  }

  /**
   * 全問題を共通の順位基準で並べる。期限超過量の降順。
   * 完全な同順位(未出題同士、または最終出題日時がミリ秒まで同じ)は重要度 A を先にし、
   * 残りはランダムにする。最終出題日時は問題ごとに異なるため、
   * この同順位の規則は実質的に未出題同士でのみ作用する。
   */
  function rankEntries(entries, now) {
    return shuffle(entries)
      .map((entry) => ({ ...entry, overdue: overdueDays(entry.progress, now) }))
      .sort((a, b) => {
        if (a.overdue !== b.overdue) {
          return b.overdue - a.overdue;
        }
        const aPriority = a.progress.importance === 'A' ? 0 : 1;
        const bPriority = b.progress.importance === 'A' ? 0 : 1;
        return aPriority - bPriority;
      });
  }

  /**
   * 出題する問題を選ぶ。
   * 0. 選択された科目で絞り込む(未指定なら全科目)
   * 1. 全問題を期限超過量の降順に並べる(未出題が最上位。期限前の問題は負の値で自然に後ろ)
   * 2. 新規(未出題)は出題数の一定割合を上限とし、残りを復習(既出題)で埋める
   * 3. 復習が不足して出題数を満たせない場合は、残りの枠を新規に開放する
   * 同じ問題を2回選ばないため、同一セッション内での重複は起きない。
   *
   * 科目ごとの均等割りはせず、絞り込んだプール全体から選ぶ。
   * 新規の上限は「復習を新規が排除しない」ためのもので、セッションの問題数を減らすものではない。
   *
   * @param {string[]} [subjects] 対象の科目。未指定・空配列なら全科目
   */
  function selectQuestions(questions, progressAll, count, now, subjects) {
    const entries = filterBySubjects(
      questions.filter((question) => question.questionType === '選択肢' || question.questionType === '正誤').map((question) => ({
        question,
        progress: getProgress(progressAll, question),
      })),
      subjects
    );

    const ranked = rankEntries(entries, now);
    const fresh = ranked.filter((entry) => !entry.progress.lastAskedAt);
    const reviewed = ranked.filter((entry) => entry.progress.lastAskedAt);

    const newCap = Math.floor(count * NEW_QUESTION_SHARE);
    const picked = fresh.slice(0, newCap);
    picked.push(...reviewed.slice(0, count - picked.length));
    if (picked.length < count) {
      picked.push(...fresh.slice(newCap, newCap + (count - picked.length)));
    }

    // 出題順は最後に混ぜる。
    return shuffle(picked).map((entry) => entry.question);
  }

  /** 出題した時点の記録。最終出題日時を更新する。 */
  function markAsked(progress, now) {
    return { ...progress, lastAskedAt: now.toISOString() };
  }

  /** 重要度(A/B/C)を変更する。 */
  function setImportance(progress, importance) {
    return { ...progress, importance };
  }

  /**
   * 正解なら箱を1つ上げ(最大5)、不正解なら箱1に戻す。
   *
   * 正誤形式は2択で当てずっぽうでも50%正解するため、正解を保留として数え、
   * 2に達した時点で箱を1つ上げて保留を0に戻す。1回目の正解では箱を維持する。
   * 不正解時は箱1に戻し、保留も0に戻す。
   *
   * @param {string} questionType 出題形式。'正誤' のときのみ判定が変わる
   */
  function applyAnswer(progress, isCorrect, questionType) {
    if (!QUESTION_TYPES.includes(questionType)) {
      // 未知の形式は選択肢形式として扱う。問題データの誤りに気づけるよう警告を出す。
      console.warn(
        `[Scheduler] 未知の出題形式 "${questionType}" を選択肢形式として扱います。`
      );
    }

    if (!isCorrect) {
      return {
        ...progress,
        box: BOX_MIN,
        wrongCount: progress.wrongCount + 1,
        pendingCorrect: 0,
      };
    }

    const correctCount = progress.correctCount + 1;

    if (questionType === QUESTION_TYPE_TRUE_FALSE) {
      const pending = (progress.pendingCorrect || 0) + 1;
      if (pending < TRUE_FALSE_CORRECT_TO_ADVANCE) {
        return { ...progress, correctCount, pendingCorrect: pending };
      }
    }

    return {
      ...progress,
      box: Math.min(progress.box + 1, BOX_MAX),
      correctCount,
      pendingCorrect: 0,
    };
  }

  return {
    BOX_INTERVAL_DAYS,
    IMPORTANCE_INTERVAL_FACTOR,
    DUE_TOLERANCE_DAYS,
    NEW_QUESTION_SHARE,
    DEFAULT_IMPORTANCE,
    QUESTION_TYPES,
    createProgress,
    getProgress,
    intervalDays,
    overdueDays,
    isDue,
    selectQuestions,
    markAsked,
    setImportance,
    applyAnswer,
  };
})();
