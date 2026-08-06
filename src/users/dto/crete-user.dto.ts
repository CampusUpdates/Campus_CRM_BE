export class CreateUserDto {
  firstName!: string;
  lastName!: string;
  email!: string;
  phone!: string;
  password!: string;
  roleId!: number;
  teamId!: number;
}