export interface VideoProcessingJobData {
  videoId: string;
}

export interface DeadLetteredVideoJobData {
  videoId: string;
  failedReason: string;
  attemptsMade: number;
}
