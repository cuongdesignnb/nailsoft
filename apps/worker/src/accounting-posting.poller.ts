import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { AccountingPostingProcessor } from "./accounting-posting.processor.js";
@Injectable()
export class AccountingPostingPoller implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout; private stopped=false; private running=false;
  constructor(@Inject(AccountingPostingProcessor) private readonly processor: AccountingPostingProcessor) {}
  onModuleInit(){if(process.env.ACCOUNTING_POSTING_WORKER_DISABLED!=="true")this.schedule(2000);}
  onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  private schedule(ms:number){if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),ms);}
  private async tick(){if(this.running)return;this.running=true;try{const n=await this.processor.run();this.schedule(n?250:Number(process.env.ACCOUNTING_POSTING_POLL_MS??10000));}catch{this.schedule(10000);}finally{this.running=false;}}
}
