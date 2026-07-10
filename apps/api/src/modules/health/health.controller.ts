import { Controller, Get } from '@nestjs/common'; import { ApiOperation, ApiTags } from '@nestjs/swagger';
@ApiTags('system') @Controller('health') export class HealthController { @Get() @ApiOperation({summary:'Service health'}) getHealth(){return {success:true,data:{status:'ok',service:'api'},meta:{requestId:'health',timestamp:new Date().toISOString()}};} }
