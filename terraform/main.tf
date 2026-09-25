provider "aws" {
  region = "eu-north-1"
}

resource "aws_security_group" "web_sg" {
  name        = "launch-wizard-1"
  description = "launch-wizard-1 created 2026-09-14T14:20:57.882Z"
  vpc_id      = "vpc-05cc621bf3256c666"

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 5173
    to_port     = 5173
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_instance" "web_server" {
  ami           = "ami-0aba19e56f3eaec05"
  instance_type = "t3.micro"

  vpc_security_group_ids = [aws_security_group.web_sg.id]

root_block_device {
    volume_size = 16
    volume_type = "gp3"
  }

  tags = {
    Name = "SocialFeed"
  }
}