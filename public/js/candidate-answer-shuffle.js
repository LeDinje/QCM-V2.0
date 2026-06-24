// js/candidate-answer-shuffle.js
export function shuffleAnswers(question){
  if (!question || !Array.isArray(question.answers)) return question;
  const arr = question.answers.map((ans, idx) => ({ ans, idx }));
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (typeof question.correctIndex === "number"){
    const oldCorrect = question.correctIndex;
    const newIndex = arr.findIndex(x => x.idx === oldCorrect);
    question.correctIndex = newIndex;
  }
  question.answers = arr.map(x => x.ans);
  return question;
}
