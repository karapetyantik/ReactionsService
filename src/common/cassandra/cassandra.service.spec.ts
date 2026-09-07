import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CassandraService } from './cassandra.service';

describe('CassandraService', () => {
  let service: CassandraService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CassandraService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(), getOrThrow: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<CassandraService>(CassandraService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
