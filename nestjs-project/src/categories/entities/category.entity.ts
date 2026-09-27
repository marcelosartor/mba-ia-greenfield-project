import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

/** Video category maintained by the platform (reference data). */
@Entity('categories')
@Unique('UQ_categories_slug', ['slug'])
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  slug: string;

  @Column({ type: 'varchar', length: 50 })
  name: string;
}
