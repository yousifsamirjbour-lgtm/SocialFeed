import { getUserDisplayName } from '../utils/user';

const UserName = ({ user, className = '' }) => {
  return <span className={className}>{getUserDisplayName(user)}</span>;
};

export default UserName;
