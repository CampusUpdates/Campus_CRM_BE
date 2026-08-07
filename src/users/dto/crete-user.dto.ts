export class CreateUserDto {
  firstName!: string;

  lastName?: string;

  email!: string;

  phone!: string;

  alternatePhone?: string;

  dob?: Date;

  roleId!: number;

  teamId!: number;

  managerId?: string;
}