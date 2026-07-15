/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PublicBookingService } from "./public-booking.service.js";

function context(req: any) {
  return {
    requestId: req.raw?.requestId ?? "unknown",
    timestamp: new Date().toISOString(),
  };
}
function token(header: string | undefined) {
  return String(header ?? "").replace(/^Bearer\s+/i, "");
}

@ApiTags("public-booking")
@Controller("public/salons/:salonSlug")
export class PublicSalonBookingController {
  constructor(
    @Inject(PublicBookingService)
    private readonly service: PublicBookingService,
  ) {}
  @Get() async salon(@Param("salonSlug") slug: string, @Req() req: any) {
    return {
      success: true,
      data: await this.service.salon(slug),
      meta: context(req),
    };
  }
  @Get("branches") async branches(
    @Param("salonSlug") slug: string,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.branches(slug),
      meta: context(req),
    };
  }
  @Get("services") async services(
    @Param("salonSlug") slug: string,
    @Query("branchId") branchId: string | undefined,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.services(slug, branchId),
      meta: context(req),
    };
  }
  @Get("availability") async availability(
    @Param("salonSlug") slug: string,
    @Query() query: any,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.search(slug, query, req.ip ?? "unknown"),
      meta: context(req),
    };
  }
  @Post("slot-holds") async hold(
    @Param("salonSlug") slug: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.createHold(
        slug,
        body,
        key ?? "",
        req.raw?.requestId ?? "unknown",
        req.ip ?? "unknown",
      ),
      meta: context(req),
    };
  }
  @Post("contact-verification/request") async contactRequest(
    @Param("salonSlug") slug: string,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.requestContact(slug, body, req.ip ?? "unknown"),
      meta: context(req),
    };
  }
  @Post("contact-verification/verify") async contactVerify(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.verifyContact(body),
      meta: context(req),
    };
  }
  @Post("bookings") async booking(
    @Param("salonSlug") slug: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.createBooking(
        slug,
        body,
        key ?? "",
        req.raw?.requestId ?? "unknown",
        req.ip ?? "unknown",
      ),
      meta: context(req),
    };
  }
}

@ApiTags("public-booking-management")
@Controller("public/bookings")
export class PublicBookingManagementController {
  constructor(
    @Inject(PublicBookingService)
    private readonly service: PublicBookingService,
  ) {}
  @Post("access/request") async request(
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.requestAccess(body, req.ip ?? "unknown"),
      meta: context(req),
    };
  }
  @Post("access/verify") async verify(@Body() body: unknown, @Req() req: any) {
    return {
      success: true,
      data: await this.service.verifyAccess(body),
      meta: context(req),
    };
  }
  @Get(":bookingReference") async get(
    @Param("bookingReference") reference: string,
    @Headers("authorization") authorization: string | undefined,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.getManaged(reference, token(authorization)),
      meta: context(req),
    };
  }
  @Post(":bookingReference/reschedule-holds") async hold(
    @Param("bookingReference") reference: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.rescheduleHold(
        reference,
        token(authorization),
        body,
        key ?? "",
        req.raw?.requestId ?? "unknown",
      ),
      meta: context(req),
    };
  }
  @Post(":bookingReference/reschedule") async reschedule(
    @Param("bookingReference") reference: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.reschedule(
        reference,
        token(authorization),
        body,
        key ?? "",
        req.raw?.requestId ?? "unknown",
      ),
      meta: context(req),
    };
  }
  @Post(":bookingReference/cancel") async cancel(
    @Param("bookingReference") reference: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: unknown,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.service.cancel(
        reference,
        token(authorization),
        body,
        key ?? "",
        req.raw?.requestId ?? "unknown",
      ),
      meta: context(req),
    };
  }
}
