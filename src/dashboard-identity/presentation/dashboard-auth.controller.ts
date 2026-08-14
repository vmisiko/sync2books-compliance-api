import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardAuthApplicationService } from '../application/dashboard-auth.application.service';
import { DashboardJwtAuthGuard } from '../infrastructure/guards/dashboard-jwt-auth.guard';
import type { DashboardRequestUser } from '../infrastructure/strategies/dashboard-jwt.strategy';
import { DashboardLoginDto } from './dto/dashboard-login.dto';
import { DashboardAuthResponseDto } from './dto/dashboard-auth-response.dto';

@Controller('dashboard-api/auth')
@ApiTags('Dashboard auth (Mode B)')
export class DashboardAuthController {
  constructor(private readonly auth: DashboardAuthApplicationService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Log in a Compliance Dashboard user (Mode B)' })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: DashboardAuthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(@Body() body: DashboardLoginDto) {
    const result = await this.auth.login(body.email, body.password);
    return {
      success: true,
      message: 'Login successful',
      data: result,
    };
  }

  @Get('me')
  @UseGuards(DashboardJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get the current dashboard user from the access token',
  })
  async me(@Req() req: Request) {
    const requestUser = req.user as DashboardRequestUser;
    const user = await this.auth.me(requestUser.userId);
    return {
      success: true,
      message: 'OK',
      data: { user },
    };
  }
}
