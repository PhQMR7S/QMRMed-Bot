import { randomUUID } from 'node:crypto';
import type { AIJobStatus, AIJobType, Prisma } from '@prisma/client';
import { db } from './db.js';
import { publishAiJob } from './vercel-queue.js';

export const JOB_LEASE_MS = 60_000;
export type EnqueueJobInput = { userId:number; type:AIJobType; idempotencyKey:string; fileId?:string; analysisId?:string; payload?:Prisma.InputJsonValue; maxAttempts?:number; availableAt?:Date };

export async function enqueueJob(input:EnqueueJobInput){
  const existing=await db.aIJob.findUnique({where:{userId_idempotencyKey:{userId:input.userId,idempotencyKey:input.idempotencyKey}}});
  if(existing){
    if(existing.status==='QUEUED'&&existing.availableAt<=new Date()) await publishAiJob(existing.id,existing.idempotencyKey).catch(()=>undefined);
    return existing;
  }
  let job;
  try{job=await db.aIJob.create({data:{id:randomUUID(),userId:input.userId,type:input.type,idempotencyKey:input.idempotencyKey,fileId:input.fileId,analysisId:input.analysisId,payload:input.payload,maxAttempts:input.maxAttempts??(input.type==='FILE_ANALYSIS'||input.type==='FILE_RESULT'?12:3),availableAt:input.availableAt??new Date()}});}
  catch(error){const raced=await db.aIJob.findUnique({where:{userId_idempotencyKey:{userId:input.userId,idempotencyKey:input.idempotencyKey}}});if(raced)return raced;throw error;}
  if(job.availableAt<=new Date()){try{await publishAiJob(job.id,job.idempotencyKey);}catch(error){console.error(JSON.stringify({event:'ai_job_publish_failed',jobId:job.id,type:job.type,error:error instanceof Error?error.message:String(error)}));throw error;}}
  return job;
}

export async function claimNextJob(workerId:string,now=new Date()){
  const staleBefore=new Date(now.getTime()-JOB_LEASE_MS);
  const candidate=await db.aIJob.findFirst({where:{OR:[{status:'QUEUED',availableAt:{lte:now}},{status:'RUNNING',heartbeatAt:{lt:staleBefore}}]},orderBy:[{availableAt:'asc'},{createdAt:'asc'}]});
  if(!candidate)return null;
  if(candidate.attempts>=candidate.maxAttempts){await db.aIJob.updateMany({where:{id:candidate.id,status:candidate.status},data:{status:'FAILED',errorCode:'MAX_ATTEMPTS',errorMessage:'Maximum retry attempts reached.',completedAt:now,lockedBy:null,lockedAt:null,heartbeatAt:null}});return null;}
  const claimed=await db.aIJob.updateMany({where:{id:candidate.id,OR:[{status:'QUEUED',availableAt:{lte:now}},{status:'RUNNING',heartbeatAt:{lt:staleBefore}}]},data:{status:'RUNNING',lockedBy:workerId,lockedAt:now,heartbeatAt:now,startedAt:candidate.startedAt??now,attempts:{increment:1},errorCode:null,errorMessage:null}});
  if(claimed.count!==1)return null;return db.aIJob.findUnique({where:{id:candidate.id}});
}
export async function heartbeatJob(jobId:string,workerId:string,progress?:number,stage?:string){return db.aIJob.updateMany({where:{id:jobId,status:'RUNNING',lockedBy:workerId},data:{heartbeatAt:new Date(),...(progress===undefined?{}:{progress:Math.max(0,Math.min(100,progress))}),...(stage===undefined?{}:{stage})}});}
export async function completeJob(jobId:string,workerId:string,result?:Prisma.InputJsonValue){return db.aIJob.updateMany({where:{id:jobId,status:'RUNNING',lockedBy:workerId},data:{status:'COMPLETED',progress:100,result,completedAt:new Date(),heartbeatAt:null,lockedBy:null,lockedAt:null}});}
export async function deferJob(jobId:string,workerId:string,afterSeconds=5){return db.aIJob.updateMany({where:{id:jobId,status:'RUNNING',lockedBy:workerId},data:{status:'QUEUED',availableAt:new Date(Date.now()+Math.max(1,Math.min(300,afterSeconds))*1000),lockedBy:null,lockedAt:null,heartbeatAt:null,errorCode:null,errorMessage:null}});}
export async function failJob(jobId:string,workerId:string,errorCode:string,errorMessage:string,retry=true){const job=await db.aIJob.findUnique({where:{id:jobId}});if(!job||job.status!=='RUNNING'||job.lockedBy!==workerId)return 0;const shouldRetry=retry&&job.attempts<job.maxAttempts;const updated=await db.aIJob.updateMany({where:{id:jobId,status:'RUNNING',lockedBy:workerId},data:{status:shouldRetry?'QUEUED':'FAILED',errorCode,errorMessage:errorMessage.slice(0,2000),availableAt:shouldRetry?new Date(Date.now()+Math.min(60_000,2**job.attempts*1000)):job.availableAt,lockedBy:null,lockedAt:null,heartbeatAt:null,...(shouldRetry?{}:{completedAt:new Date()})}});return updated.count;}
export async function cancelJob(jobId:string,userId:number){return db.aIJob.updateMany({where:{id:jobId,userId,status:{in:['QUEUED','RUNNING']}},data:{status:'CANCELLED',completedAt:new Date(),lockedBy:null,lockedAt:null,heartbeatAt:null}});}
export function isTerminalJobStatus(status:AIJobStatus){return status==='COMPLETED'||status==='FAILED'||status==='CANCELLED';}
