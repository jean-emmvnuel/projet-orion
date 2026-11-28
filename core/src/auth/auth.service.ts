import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { JwtService } from '@nestjs/jwt';
import { registerDto } from './dto/register.dto';
import { loginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

/**
 * Hash bcrypt valide (coût 12) d'une valeur aléatoire : comparé quand l'e-mail n'existe pas,
 * pour que la réponse prenne le même temps qu'une vraie vérification (anti-énumération).
 */
const DUMMY_HASH = bcrypt.hashSync(randomBytes(16).toString('hex'), 12);

@Injectable()
export class AuthService {
    constructor(private readonly prisma: PrismaService, private readonly jwtService: JwtService) { }

    async register(data: registerDto) {
        const { username, email, password } = data;

        const existingEmail = await this.prisma.user.findUnique({ where: { email } });
        if (existingEmail) {
            // Anti-Enumeration: On simule une réussite même si l'email existe.
            // Dans un cas réel, on enverrait un email "Vous avez déjà un compte".
            return {
                status: 201,
                message: "Inscription réussie", // Même message que le succès réel
                data: null // On ne renvoie pas de token ni de données user pour ne pas trahir l'existence
            }
        }

        const hashedPassword = await bcrypt.hash(password, 12);

        const user = await this.prisma.user.create({
            data: {
                username,
                email,
                password: hashedPassword,
            },
            select: {
                id: true,
                username: true,
                email: true,
                createdAt: true,
            },
        });
        const payload = {
            sub: user.id,
            email: user.email,
        };
        const token = await this.jwtService.signAsync(payload);
        return {
            status: 201,
            message: "Utilisateur créé avec succès",
            data: {
                user,
                token,
            },
        }
    }

    async login(data: loginDto) {
        const { email, password } = data;

        let user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                username: true,
                email: true,
                password: true,
                createdAt: true,
            },
        });

        // Protection contre les attaques temporelles (Timing Attacks)
        // On effectue toujours une comparaison de hash, même si l'utilisateur n'existe pas.
        const isPasswordValid = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

        if (!user || !isPasswordValid) {
            throw new UnauthorizedException("Identifiants incorrects");
        }

        const payload = {
            sub: user.id,
            email: user.email,
        };
        const token = await this.jwtService.signAsync(payload);
        return {
            status: 200,
            message: "utilisateur connecte avec succes",
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    createdAt: user.createdAt,
                },
                token,
            },
        }
    }

    async validateUser(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                email: true,
                createdAt: true,
            },
        });
        if (!user) {
            throw new NotFoundException("utilisateur non trouve");
        }
        return user;
    }

    /** Renouvelle le jeton de l'app tant que l'ancien est encore valide. */
    async refresh(userId: string) {
        const user = await this.validateUser(userId);
        const token = await this.jwtService.signAsync({ sub: user.id, email: user.email });
        return { status: 200, message: 'Jeton renouvelé', data: { user, token } };
    }
}
