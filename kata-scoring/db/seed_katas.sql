-- Annexe 1 : liste officielle des katas WKF 2026.0 (le numéro fait foi, art. 6.3)
INSERT INTO katas (number, name) VALUES
(1,'Anan'),(2,'Anan Dai'),(3,'Ananko'),(4,'Aoyagi'),(5,'Bassai'),(6,'Bassai Dai'),(7,'Bassai Sho'),
(8,'Chatanyara Kusanku'),(9,'Chibana No Kushanku'),(10,'Chinte'),(11,'Chinto'),(12,'Enpi'),
(13,'Fukyugata Ichi'),(14,'Fukyugata Ni'),(15,'Gankaku'),(16,'Garyu'),(17,'Gekisai (Geksai) 1'),
(18,'Gekisai (Geksai) 2'),(19,'Gojushiho'),(20,'Gojushiho Dai'),(21,'Gojushiho Sho'),(22,'Hakusho'),
(23,'Hangetsu'),(24,'Haufa (Haffa)'),(25,'Heian Shodan'),(26,'Heian Nidan'),(27,'Heian Sandan'),
(28,'Heian Yondan'),(29,'Heian Godan'),(30,'Heiku'),(31,'Ishimine Bassai'),(32,'Itosu Rohai Shodan'),
(33,'Itosu Rohai Nidan'),(34,'Itosu Rohai Sandan'),(35,'Jiin'),(36,'Jion'),(37,'Jitte'),(38,'Juroku'),
(39,'Kanchin'),(40,'Kanku Dai'),(41,'Kanku Sho'),(42,'Kanshu'),(43,'Kishimono No Kushanku'),
(44,'Kousoukun'),(45,'Kousoukun Dai'),(46,'Kousoukun Sho'),(47,'Kururunfa'),(48,'Kusanku'),
(49,'Kyan No Chinto'),(50,'Kyan No Wanshu'),(51,'Matsukaze'),(52,'Matsumura Bassai'),
(53,'Matsumura Rohai'),(54,'Meikyo'),(55,'Myojo'),(56,'Naifanchin Shodan'),(57,'Naifanchin Nidan'),
(58,'Naifanchin Sandan'),(59,'Naihanchi'),(60,'Nijushiho'),(61,'Nipaipo'),(62,'Niseishi'),(63,'Ohan'),
(64,'Ohan Dai'),(65,'Oyadomari No Passai'),(66,'Pachu'),(67,'Paiku'),(68,'Papuren'),(69,'Passai'),
(70,'Pinan Shodan'),(71,'Pinan Nidan'),(72,'Pinan Sandan'),(73,'Pinan Yondan'),(74,'Pinan Godan'),
(75,'Rohai'),(76,'Saifa'),(77,'Sanchin'),(78,'Sansai'),(79,'Sanseiru'),(80,'Sanseru'),(81,'Seichin'),
(82,'Seienchin (Seiyunchin)'),(83,'Seipai'),(84,'Seiryu'),(85,'Seishan'),(86,'Seisan (Sesan)'),
(87,'Shiho Kousoukun'),(88,'Shinpa'),(89,'Shinsei'),(90,'Shisochin'),(91,'Sochin'),(92,'Suparinpei'),
(93,'Tekki Shodan'),(94,'Tekki Nidan'),(95,'Tekki Sandan'),(96,'Tensho'),(97,'Tomari Bassai'),
(98,'Unshu'),(99,'Unsu'),(100,'Useishi'),(101,'Wankan'),(102,'Wanshu')
ON CONFLICT (number) DO NOTHING;
