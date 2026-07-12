/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "../identity/auth.guard.js";
import { PermissionGuard } from "../identity/permission.guard.js";
import { RequireAnyPermission, RequirePermission } from "../identity/permission.decorator.js";
import type { AuthenticatedRequest } from "../identity/auth.types.js";
import { ServiceCatalogService } from "./service-catalog.service.js";

@ApiTags("service-catalog")
@ApiBearerAuth()
@UseGuards(AuthGuard, PermissionGuard)
@Controller()
export class ServiceCatalogController {
  constructor(@Inject(ServiceCatalogService) private readonly service: ServiceCatalogService) {}
  private async ok<T>(data:T|Promise<T>, req:AuthenticatedRequest, extra:Record<string,unknown>={}) { return { success:true, data:await data, meta:{ requestId:req.raw.requestId??"unknown", timestamp:new Date().toISOString(), ...extra } }; }
  private rid(req:AuthenticatedRequest) { return req.raw.requestId??"unknown"; }
  @Get("service-categories") @RequirePermission("service_category.read") categories(@Query() q:any,@Req() req:AuthenticatedRequest){return this.ok(this.service.categories(req.auth,q),req);}
  @Post("service-categories") @RequirePermission("service_category.create") createCategory(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createCategory(req.auth,b,this.rid(req)),req);}
  @Get("service-categories/:id") @RequirePermission("service_category.read") category(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.category(req.auth,id),req);}
  @Patch("service-categories/:id") @RequirePermission("service_category.update") updateCategory(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateCategory(req.auth,id,b,this.rid(req)),req);}
  @Post("service-categories/:id/archive") @RequirePermission("service_category.archive") archiveCategory(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.archiveCategory(req.auth,id,this.rid(req)),req);}
  @Post("service-categories/reorder") @RequirePermission("service_category.update") reorder(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.reorderCategories(req.auth,b,this.rid(req)),req);}

  @Get("services") @RequirePermission("service.read") async services(@Query() q:any,@Req() req:AuthenticatedRequest){const d=await this.service.services(req.auth,q);return this.ok(d.items,req,{page:d.page,pageSize:d.pageSize,total:d.total,totalPages:d.totalPages});}
  @Post("services") @RequirePermission("service.create") createService(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createService(req.auth,b,this.rid(req)),req);}
  @Get("services/:id") @RequirePermission("service.read") getService(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.service(req.auth,id),req);}
  @Patch("services/:id") @RequirePermission("service.update") updateService(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateService(req.auth,id,b,this.rid(req)),req);}
  @Post("services/:id/activate") @RequirePermission("service.activate") activateService(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.serviceStatus(req.auth,id,"ACTIVE",this.rid(req)),req);}
  @Post("services/:id/deactivate") @RequirePermission("service.update") deactivateService(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.serviceStatus(req.auth,id,"INACTIVE",this.rid(req)),req);}
  @Post("services/:id/archive") @RequirePermission("service.archive") archiveService(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.serviceStatus(req.auth,id,"ARCHIVED",this.rid(req)),req);}
  @Get("services/:id/prices") @RequirePermission("service_price.read") prices(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.prices(req.auth,id),req);}
  @Post("services/:id/prices") @RequirePermission("service_price.create") createPrice(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createPrice(req.auth,id,b,this.rid(req)),req);}
  @Patch("services/:id/prices/:priceId") @RequirePermission("service_price.update") updatePrice(@Param("id") id:string,@Param("priceId") priceId:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updatePrice(req.auth,id,priceId,b,this.rid(req)),req);}
  @Post("services/:id/prices/:priceId/cancel") @RequirePermission("service_price.cancel") cancelPrice(@Param("id") id:string,@Param("priceId") priceId:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.cancelPrice(req.auth,id,priceId,this.rid(req)),req);}
  @Get("services/:id/addons") @RequirePermission("service.read") addons(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.addons(req.auth,id),req);}
  @Put("services/:id/addons") @RequirePermission("service.update") putAddons(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.putAddons(req.auth,id,b,this.rid(req)),req);}
  @Get("services/:id/skills") @RequirePermission("service.read") serviceSkills(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.serviceSkills(req.auth,id),req);}
  @Put("services/:id/skills") @RequirePermission("service.update") putServiceSkills(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.putServiceSkills(req.auth,id,b,this.rid(req)),req);}
  @Get("services/:id/resources") @RequirePermission("service.read") serviceResources(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.serviceResources(req.auth,id),req);}
  @Put("services/:id/resources") @RequirePermission("service.update") putServiceResources(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.putServiceResources(req.auth,id,b,this.rid(req)),req);}

  @Get("skills") @RequirePermission("skill.read") skills(@Req() req:AuthenticatedRequest){return this.ok(this.service.skills(req.auth),req);}
  @Post("skills") @RequirePermission("skill.create") createSkill(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createSkill(req.auth,b,this.rid(req)),req);}
  @Get("skills/:id") @RequirePermission("skill.read") skill(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.skill(req.auth,id),req);}
  @Patch("skills/:id") @RequirePermission("skill.update") updateSkill(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateSkill(req.auth,id,b,this.rid(req)),req);}
  @Post("skills/:id/archive") @RequirePermission("skill.archive") archiveSkill(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.archiveSkill(req.auth,id,this.rid(req)),req);}
  @Get("resource-types") @RequirePermission("resource.read") resourceTypes(@Req() req:AuthenticatedRequest){return this.ok(this.service.resourceTypes(req.auth),req);}
  @Post("resource-types") @RequirePermission("resource.create") createResourceType(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createResourceType(req.auth,b,this.rid(req)),req);}
  @Patch("resource-types/:id") @RequirePermission("resource.update") updateResourceType(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateResourceType(req.auth,id,b,this.rid(req)),req);}
  @Get("resources") @RequirePermission("resource.read") resources(@Query() q:any,@Req() req:AuthenticatedRequest){return this.ok(this.service.resources(req.auth,q),req);}
  @Post("resources") @RequirePermission("resource.create") createResource(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createResource(req.auth,b,this.rid(req)),req);}
  @Get("resources/:id") @RequirePermission("resource.read") resource(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.resource(req.auth,id),req);}
  @Patch("resources/:id") @RequirePermission("resource.update") updateResource(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateResource(req.auth,id,b,this.rid(req)),req);}
  @Post("resources/:id/archive") @RequirePermission("resource.archive") archiveResource(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.archiveResource(req.auth,id,this.rid(req)),req);}

  @Get("staff") @RequirePermission("staff.read") staff(@Query() q:any,@Req() req:AuthenticatedRequest){return this.ok(this.service.staff(req.auth,q),req);}
  @Get("staff/me") @RequirePermission("staff.read") staffMe(@Req() req:AuthenticatedRequest){return this.ok(this.service.staffMe(req.auth),req);}
  @Post("staff") @RequirePermission("staff.create") createStaff(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createStaff(req.auth,b,this.rid(req)),req);}
  @Get("staff/:id") @RequirePermission("staff.read") staffOne(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffOne(req.auth,id),req);}
  @Patch("staff/:id") @RequirePermission("staff.update") updateStaff(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateStaff(req.auth,id,b,this.rid(req)),req);}
  @Post("staff/:id/activate") @RequirePermission("staff.update") activateStaff(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffStatus(req.auth,id,"ACTIVE",this.rid(req)),req);}
  @Post("staff/:id/suspend") @RequirePermission("staff.update") suspendStaff(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffStatus(req.auth,id,"SUSPENDED",this.rid(req)),req);}
  @Post("staff/:id/terminate") @RequirePermission("staff.update") terminateStaff(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffStatus(req.auth,id,"TERMINATED",this.rid(req)),req);}
  @Post("staff/:id/archive") @RequirePermission("staff.archive") archiveStaff(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffStatus(req.auth,id,"ARCHIVED",this.rid(req)),req);}
  @Get("staff/:id/branches") @RequirePermission("staff.read") assignments(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.assignments(req.auth,id),req);}
  @Post("staff/:id/branches") @RequirePermission("staff.assign_branch") assignBranch(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.assignBranch(req.auth,id,b,this.rid(req)),req);}
  @Delete("staff/:id/branches/:assignmentId") @RequirePermission("staff.assign_branch") endAssignment(@Param("id") id:string,@Param("assignmentId") assignmentId:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.endAssignment(req.auth,id,assignmentId,this.rid(req)),req);}
  @Patch("staff/:id/branches/:assignmentId") @RequirePermission("staff.assign_branch") updateAssignment(@Param("id") id:string,@Param("assignmentId") assignmentId:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateAssignment(req.auth,id,assignmentId,b,this.rid(req)),req);}
  @Get("staff/:id/skills") @RequirePermission("staff.read") staffSkills(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.staffSkills(req.auth,id),req);}
  @Put("staff/:id/skills") @RequirePermission("staff.assign_skill") putStaffSkills(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.putStaffSkills(req.auth,id,b,this.rid(req)),req);}

  @Get("shifts") @RequirePermission("shift.read") shifts(@Query() q:any,@Req() req:AuthenticatedRequest){return this.ok(this.service.shifts(req.auth,q),req);}
  @Post("shifts") @RequirePermission("shift.create") createShift(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createShift(req.auth,b,this.rid(req)),req);}
  @Get("shifts/:id") @RequirePermission("shift.read") shift(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.shift(req.auth,id),req);}
  @Patch("shifts/:id") @RequirePermission("shift.update") updateShift(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateShift(req.auth,id,b,this.rid(req)),req);}
  @Post("shifts/:id/publish") @RequirePermission("shift.publish") publishShift(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.shiftStatus(req.auth,id,"PUBLISHED",this.rid(req)),req);}
  @Post("shifts/:id/cancel") @RequirePermission("shift.cancel") cancelShift(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.shiftStatus(req.auth,id,"CANCELLED",this.rid(req)),req);}
  @Get("shift-recurrence-rules") @RequirePermission("shift.read") recurrenceRules(@Req() req:AuthenticatedRequest){return this.ok(this.service.recurrenceRules(req.auth),req);}
  @Post("shift-recurrence-rules") @RequirePermission("shift.create") createRecurrence(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createRecurrence(req.auth,b,this.rid(req)),req);}
  @Patch("shift-recurrence-rules/:id") @RequirePermission("shift.update") updateRecurrence(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateRecurrence(req.auth,id,b),req);}
  @Post("shift-recurrence-rules/:id/pause") @RequirePermission("shift.update") pauseRecurrence(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateRecurrence(req.auth,id,{status:"PAUSED"}),req);}
  @Post("shift-recurrence-rules/:id/resume") @RequirePermission("shift.update") resumeRecurrence(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateRecurrence(req.auth,id,{status:"ACTIVE"}),req);}

  @Get("leave-requests") @RequireAnyPermission("leave.read_branch","leave.read_own") leaves(@Query() q:any,@Req() req:AuthenticatedRequest){return this.ok(this.service.leaves(req.auth,q),req);}
  @Post("leave-requests") @RequireAnyPermission("leave.create_own","leave.create_branch") createLeave(@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.createLeave(req.auth,b,this.rid(req)),req);}
  @Get("leave-requests/:id") @RequireAnyPermission("leave.read_branch","leave.read_own") leave(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.leave(req.auth,id),req);}
  @Patch("leave-requests/:id") @RequireAnyPermission("leave.create_own","leave.create_branch") updateLeave(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.updateLeave(req.auth,id,b,this.rid(req)),req);}
  @Post("leave-requests/:id/submit") @RequirePermission("leave.create_own") submitLeave(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.leaveTransition(req.auth,id,"PENDING",{},this.rid(req)),req);}
  @Post("leave-requests/:id/approve") @RequirePermission("leave.review_branch") approveLeave(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.leaveTransition(req.auth,id,"APPROVED",b,this.rid(req)),req);}
  @Post("leave-requests/:id/reject") @RequirePermission("leave.review_branch") rejectLeave(@Param("id") id:string,@Body() b:unknown,@Req() req:AuthenticatedRequest){return this.ok(this.service.leaveTransition(req.auth,id,"REJECTED",b,this.rid(req)),req);}
  @Post("leave-requests/:id/cancel") @RequirePermission("leave.cancel") cancelLeave(@Param("id") id:string,@Req() req:AuthenticatedRequest){return this.ok(this.service.leaveTransition(req.auth,id,"CANCELLED",{},this.rid(req)),req);}
}
