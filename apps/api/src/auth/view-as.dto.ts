import { IsBoolean, IsUUID } from 'class-validator';

/** POST /auth/view-as: the user a Super Admin switches to. */
export class ViewAsDto {
  @IsUUID('all', { message: 'Choose the user to view as.' })
  userId: string;
}

/** POST /auth/view-as/act: Act as them on or off. */
export class ViewAsActDto {
  @IsBoolean({ message: 'Choose whether to act as them.' })
  act: boolean;
}
