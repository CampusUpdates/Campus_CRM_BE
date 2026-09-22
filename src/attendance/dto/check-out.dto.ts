export class CheckOutResponseDto {
  id!: string;
  userId!: string;
  officeId!: number;
  date!: Date;
  checkIn!: Date | null;
  checkOut!: Date | null;
  workingHours!: string | null;
  status!: string;
}
