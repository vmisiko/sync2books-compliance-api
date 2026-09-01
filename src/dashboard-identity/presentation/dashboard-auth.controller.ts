import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import {
  ApiBearerAuth,
  ApiExcludeEndpoint,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { DashboardAuthApplicationService } from '../application/dashboard-auth.application.service';
import { DashboardJwtAuthGuard } from '../infrastructure/guards/dashboard-jwt-auth.guard';
import {
  GoogleOAuthConfiguredGuard,
  MicrosoftOAuthConfiguredGuard,
} from '../infrastructure/guards/oauth-configured.guard';
import type { DashboardRequestUser } from '../infrastructure/strategies/dashboard-jwt.strategy';
import { dashboardAppUrl } from '../infrastructure/oauth/dashboard-app-url';
import type { OAuthProfile } from '../infrastructure/oauth/oauth-profile.type';
import { DashboardLoginDto } from './dto/dashboard-login.dto';
import { DashboardSignUpDto } from './dto/dashboard-signup.dto';
import { CompleteOAuthSignUpDto } from './dto/complete-oauth-signup.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { AcceptPasswordResetDto } from './dto/accept-password-reset.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { DashboardAuthResponseDto } from './dto/dashboard-auth-response.dto';

@Controller('dashboard-api/auth')
@ApiTags('Dashboard auth (Mode B)')
export class DashboardAuthController {
  constructor(private readonly auth: DashboardAuthApplicationService) {}

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a new organisation + its first admin user (Mode B). Auto-provisions the matching main-API Organization/Application.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: DashboardAuthResponseDto,
  })
  async signup(@Body() body: DashboardSignUpDto) {
    const result = await this.auth.signUp(body);
    return {
      success: true,
      message: 'Account created successfully',
      data: result,
    };
  }

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

  @Get('google')
  @UseGuards(GoogleOAuthConfiguredGuard, AuthGuard('google'))
  @ApiExcludeEndpoint()
  googleAuth(): void {
    // GoogleOAuthConfiguredGuard already rejected this if unconfigured; by
    // the time we're here, AuthGuard('google') has already redirected to
    // Google's consent screen as a side effect of its own canActivate(), so
    // this body never actually runs.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  async googleAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleOAuthCallback(req.user as OAuthProfile, res);
  }

  @Get('microsoft')
  @UseGuards(MicrosoftOAuthConfiguredGuard, AuthGuard('microsoft'))
  @ApiExcludeEndpoint()
  microsoftAuth(): void {
    // See googleAuth() -- same reasoning, mirrored for Microsoft.
  }

  @Get('microsoft/callback')
  @UseGuards(AuthGuard('microsoft'))
  @ApiExcludeEndpoint()
  async microsoftAuthCallback(
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    await this.handleOAuthCallback(req.user as OAuthProfile, res);
  }

  @Post('oauth/complete')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Finish a brand-new Google/Microsoft sign-up by naming the organisation, using the ticket from the callback redirect's #ticket fragment.",
  })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: DashboardAuthResponseDto,
  })
  async completeOAuthSignUp(@Body() body: CompleteOAuthSignUpDto) {
    const result = await this.auth.completeOAuthSignUp(
      body.ticket,
      body.organizationName,
    );
    return {
      success: true,
      message: 'Account created successfully',
      data: result,
    };
  }

  /**
   * Shared by both providers' callback routes. Redirects back to the
   * frontend rather than returning JSON -- this request arrived via a full
   * browser navigation from Google/Microsoft, not an XHR the SPA can read a
   * response body from. Tokens travel in the URL fragment (`#...`), never
   * the query string, so they never reach this server's (or any proxy's)
   * access logs or Referer headers.
   */
  private async handleOAuthCallback(
    profile: OAuthProfile,
    res: Response,
  ): Promise<void> {
    const appUrl = dashboardAppUrl();
    try {
      const result = await this.auth.loginOrSignUpWithOAuth(profile);
      if ('pending' in result) {
        const params = new URLSearchParams({
          ticket: result.ticket,
          email: result.email,
          firstName: result.firstName,
          lastName: result.lastName,
          provider: profile.provider,
        });
        res.redirect(`${appUrl}/signup/complete#${params.toString()}`);
        return;
      }

      const session = Buffer.from(JSON.stringify(result)).toString('base64url');
      res.redirect(`${appUrl}/auth/callback#session=${session}`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'OAuth sign-in failed';
      res.redirect(`${appUrl}/login?error=${encodeURIComponent(message)}`);
    }
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

  @Get('members')
  @UseGuards(DashboardJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the caller's organisation's members" })
  async listMembers(@Req() req: Request) {
    const requestUser = req.user as DashboardRequestUser;
    const members = await this.auth.listMembers(requestUser.organizationId);
    return { success: true, message: 'OK', data: { members } };
  }

  @Post('members')
  @UseGuards(DashboardJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Generate a shareable invite link for a teammate to join the caller's organisation and set their own password. No email is sent (v1 has no email delivery) — copy the returned link and share it yourself. Nothing is created for them until they actually accept it.",
  })
  async inviteMember(@Req() req: Request, @Body() body: CreateMemberDto) {
    const requestUser = req.user as DashboardRequestUser;
    const invite = await this.auth.createInvite({
      email: body.email,
      displayName: body.displayName,
      role: body.role,
      organizationId: requestUser.organizationId,
    });
    return {
      success: true,
      message: 'Invite created',
      data: invite,
    };
  }

  @Get('invite/:token')
  @ApiOperation({
    summary:
      "Preview an invite before accepting it (who's inviting them, to which org, as what role) without consuming it. Public — the invitee has no account/session yet.",
  })
  async getInvite(@Param('token') token: string) {
    const preview = await this.auth.getInvitePreview(token);
    return { success: true, message: 'OK', data: preview };
  }

  @Post('invite/accept')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Accept an invite by setting a password. Creates the account and logs them straight in, same as signup. Public — the invitee has no account/session yet.",
  })
  @ApiResponse({
    status: 201,
    description: 'Account created',
    type: DashboardAuthResponseDto,
  })
  async acceptInvite(@Body() body: AcceptInviteDto) {
    const result = await this.auth.acceptInvite(body.token, body.password);
    return {
      success: true,
      message: 'Account created successfully',
      data: result,
    };
  }

  @Patch('members/:id')
  @UseGuards(DashboardJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Change a teammate's role or active/deactivated status. Scoped to the caller's organisation. Deactivating rejects self-deactivation and deactivating the org's last active admin.",
  })
  async updateMember(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateMemberDto,
  ) {
    const requestUser = req.user as DashboardRequestUser;
    const user = await this.auth.updateMember(
      requestUser.organizationId,
      requestUser.userId,
      id,
      body,
    );
    return { success: true, message: 'Member updated', data: { user } };
  }

  @Post('members/:id/reset-password')
  @UseGuards(DashboardJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      "Generate a shareable link that lets an existing teammate set a brand-new password. No email is sent (v1 has no email delivery) — copy the returned link and share it yourself. Nothing changes for them until the link is used.",
  })
  async resetMemberPassword(@Req() req: Request, @Param('id') id: string) {
    const requestUser = req.user as DashboardRequestUser;
    const reset = await this.auth.createPasswordReset(
      requestUser.organizationId,
      id,
    );
    return {
      success: true,
      message: 'Password reset link created',
      data: reset,
    };
  }

  @Get('reset-password/:token')
  @ApiOperation({
    summary:
      "Preview a password reset link (whose it is, which org) without consuming it. Public — the member hasn't authenticated with the new password yet.",
  })
  async getPasswordReset(@Param('token') token: string) {
    const preview = await this.auth.getPasswordResetPreview(token);
    return { success: true, message: 'OK', data: preview };
  }

  @Post('reset-password/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Accept a password reset link by setting a new password. Logs the member straight in, same as invite acceptance. Public — the member has no valid session for this yet.',
  })
  @ApiResponse({
    status: 200,
    description: 'Password reset',
    type: DashboardAuthResponseDto,
  })
  async acceptPasswordReset(@Body() body: AcceptPasswordResetDto) {
    const result = await this.auth.resetPassword(body.token, body.password);
    return {
      success: true,
      message: 'Password reset successfully',
      data: result,
    };
  }
}
