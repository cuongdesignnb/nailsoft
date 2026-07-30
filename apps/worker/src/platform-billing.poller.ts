import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PlatformBillingProcessor } from "./platform-billing.processor.js";
@Injectable()
export class PlatformBillingPoller implements OnModuleInit,OnModuleDestroy{
  private timer?:NodeJS.Timeout;private stopped=false;private running=false;
  constructor(@Inject(PlatformBillingProcessor)private readonly processor:PlatformBillingProcessor){}
  onModuleInit(){if(process.env.PLATFORM_BILLING_WORKER_DISABLED!=="true")this.schedule(1800);}
  onModuleDestroy(){this.stopped=true;if(this.timer)clearTimeout(this.timer);}
  private schedule(ms:number){if(!this.stopped)this.timer=setTimeout(()=>void this.tick(),ms);}
  private async tick(){if(this.running)return;this.running=true;try{const count=await this.processor.run();this.schedule(count?250:Number(process.env.PLATFORM_BILLING_POLL_MS??10000));}catch{this.schedule(10000);}finally{this.running=false;}}
}
