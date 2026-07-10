import { Module } from '@nestjs/common'; import { OutboxProcessor } from './outbox.processor.js'; @Module({providers:[OutboxProcessor]}) export class WorkerModule {}
