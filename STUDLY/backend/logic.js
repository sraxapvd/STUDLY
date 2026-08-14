function calculateAssignmentStatus(a,submission,now=new Date()){
  const deadline=new Date(a.deadline);
  if(submission?.teacherVerified && submission.score!==undefined && submission.score!==null) return 'GRADED';
  if(submission?.status==='NOT_RECEIVED') return deadline>now?'NOT_SUBMITTED':'OVERDUE';
  if(submission) return 'SUBMITTED';
  return deadline>now?'NOT_SUBMITTED':'OVERDUE';
}
function riskFrom(subject, assignments, submissions, scores){
  const current=Number(subject.score||0);
  const relevant=assignments.filter(a=>a.subject===subject.name);
  const pending=relevant.filter(a=>!submissions.some(s=>s.assignmentId===a.id&&s.studentId==='stu-001'));
  const overdue=pending.filter(a=>new Date(a.deadline)<new Date()).length;
  const near=pending.filter(a=>{const h=(new Date(a.deadline)-new Date())/36e5;return h>=0&&h<=48;}).length;
  if(current<50 || overdue>=2 || (current<60&&near>=1)) return 'HIGH';
  if(current<75 || overdue>=1 || near>=1) return 'MEDIUM';
  return 'LOW';
}
function calculatePriority(a,subject,status){
  if(status==='GRADED') return {level:'LOW',score:0,reasons:['ตรวจและให้คะแนนเรียบร้อย']};
  const hours=Math.max(0,(new Date(a.deadline)-new Date())/36e5);
  let score=0,reasons=[];
  if(hours<24){score+=40;reasons.push('Deadline ภายใน 24 ชั่วโมง');}
  else if(hours<72){score+=25;reasons.push('Deadline ใกล้');}
  if(Number(a.maxScore)>=25){score+=20;reasons.push(`${a.maxScore} คะแนน`);}
  else if(Number(a.maxScore)>=15){score+=10;reasons.push(`${a.maxScore} คะแนน`);}
  if(Number(a.weight)>=15){score+=15;reasons.push(`น้ำหนัก ${a.weight}%`);}
  if(Number(subject.score)<50){score+=20;reasons.push(`${subject.name} คะแนนปัจจุบัน ${subject.score}%`);}
  else if(Number(subject.score)<75){score+=10;reasons.push(`${subject.name} คะแนนปัจจุบัน ${subject.score}%`);}
  if(a.difficulty==='ยาก') {score+=8;reasons.push('ความยากสูง');}
  if(status==='OVERDUE'){score+=30;reasons.push('เลยกำหนดแล้ว');}
  const level=score>=45?'HIGH':score>=25?'MEDIUM':'LOW';
  return {level,score,reasons};
}
module.exports={calculateAssignmentStatus,calculatePriority,riskFrom};
