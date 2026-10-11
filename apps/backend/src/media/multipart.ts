import { SetMetadata } from '@nestjs/common';

export const MULTIPART_ROUTE = 'olconet:multipart';
export const Multipart = () => SetMetadata(MULTIPART_ROUTE, true);
