import { Injectable } from '@nestjs/common'; @Injectable() export class OutboxProcessor { readonly sourceOfTruth='postgresql'; }
