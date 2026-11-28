import { Body, Controller, Get, Post, Request, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { registerDto } from './dto/register.dto';
import { loginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt.auth.guard';

@Controller('auth')
export class AuthController {
    constructor(private readonly authService: AuthService) {}

    // Routes sensibles : 10 essais par minute et par IP.
    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post('/register')
    async register(@Body() data: registerDto) {
        return this.authService.register(data);
    }

    @Throttle({ default: { limit: 10, ttl: 60_000 } })
    @Post('/login')
    async login(@Body() data: loginDto) {
        return this.authService.login(data);
    }

    @UseGuards(JwtAuthGuard)
    @Get("/me")
    async me(@Request() req) {
        return this.authService.validateUser(req.user.sub);
    }

    @UseGuards(JwtAuthGuard)
    @Post('/refresh')
    async refresh(@Request() req) {
        return this.authService.refresh(req.user.sub);
    }
}
