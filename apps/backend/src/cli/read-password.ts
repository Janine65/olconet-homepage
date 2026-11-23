import { BadRequestException } from '@nestjs/common';
import { validatePassword } from '../auth/auth.input';

export async function readPassword(fromStdin: boolean) {
  let password: string;
  if (fromStdin) {
    let input = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) {
      input += String(chunk);
      if (Buffer.byteLength(input) > 130) throw new BadRequestException('Passworteingabe ist zu lang.');
    }
    password = input.replace(/\r?\n$/, '');
  } else {
    if (!process.stdin.isTTY) throw new BadRequestException('Ein Terminal oder --password-stdin ist erforderlich.');
    const { password: passwordPrompt } = await import('@inquirer/prompts');
    password = await passwordPrompt({ message: 'Passwort (mindestens 12 Zeichen):', mask: '*' });
    const confirmation = await passwordPrompt({ message: 'Passwort wiederholen:', mask: '*' });
    if (password !== confirmation) throw new BadRequestException('Die Passwörter stimmen nicht überein.');
  }
  return validatePassword(password, true);
}
